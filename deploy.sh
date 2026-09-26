#!/usr/bin/env bash
set -euo pipefail

SSH_KEY="${HOME}/.ssh/investmentoptimizer.pem"
REMOTE_USER="ubuntu"
REMOTE_HOST="${REMOTE_HOST:-13.60.148.85}"
REMOTE_DIR="/home/ubuntu/wishlist"
DATA_DIR="/home/ubuntu/wishlist/data"

# Data reconciliation: Lightsail is authoritative by default — real wishlist items
# and feature requests are created by people using the live app, never by local
# dev/testing. A local backend run for verification writes real files to
# backend/data/ that must never leak to production on the next deploy (same class
# of incident as investmentoptimizer's SAMPO snapshot corruption — see its
# CLAUDE.md "2026-08-29 incident"). Local is always backed up before being
# overwritten, but never merged in silently.
#
#   PREFER_LOCAL=1 ./deploy.sh   # explicit override: push local to remote instead
#                                 # (e.g. after a manual local data clean-up)
PREFER_LOCAL="${PREFER_LOCAL:-0}"

usage() {
  echo "Usage: $0 [--host <ip|hostname>] [--user <ssh-user>] [--key <path-to-pem>]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --host) REMOTE_HOST=$2; shift 2 ;;
    --user) REMOTE_USER=$2; shift 2 ;;
    --key)  SSH_KEY=$2; shift 2 ;;
    *)      usage ;;
  esac
done

SSH="ssh -i ${SSH_KEY} ${REMOTE_USER}@${REMOTE_HOST}"
SCP="scp -i ${SSH_KEY}"

die() { echo "ERROR: $1" >&2; exit 1; }

ssh_retry() {
  local tries=0
  until $SSH "$@"; do
    tries=$((tries+1))
    [[ $tries -ge 5 ]] && { echo "SSH command failed after $tries tries"; exit 1; }
    sleep 3
  done
}

# ── Ensure local data dir exists ──────────────────────────────────────────────

mkdir -p data

# ── Ensure remote data files exist ───────────────────────────────────────────

echo "Checking remote data files..."
$SSH "mkdir -p ${DATA_DIR}"
ssh_retry "[ -f ${DATA_DIR}/wishlist-items.json ]    || echo '[]' > ${DATA_DIR}/wishlist-items.json"
ssh_retry "[ -f ${DATA_DIR}/users.json ]             || echo '[]' > ${DATA_DIR}/users.json"
ssh_retry "[ -f ${DATA_DIR}/feature-requests.json ]  || echo '[]' > ${DATA_DIR}/feature-requests.json"

# ── Reconciliation helpers ──────────────────────────────────────────────────
#
# Remote (Lightsail) is authoritative by default for wishlist-items.json and
# users.json: local is only ever a backup, overwritten with the remote version
# on every deploy. PREFER_LOCAL=1 flips wishlist-items.json to push-local-instead,
# for deliberate local data clean-up (users.json has no such override — nothing
# legitimately writes it locally, ever).
#
# SHRINK_GUARD protects both of them from the failure mode that override exists
# for: a remote copy that's missing or has lost most of its records (a wiped
# volume, a bad restart, wrong DATA_DIR, etc.) must never silently overwrite a
# good local backup just because "remote wins by default." When that's detected,
# the script demands an interactive terminal to decide what happens next — pull
# the smaller remote anyway, or push local up to fix remote — and refuses
# outright in a non-interactive run (no one present to confirm real data loss).

SHRINK_GUARD_FACTOR=2   # remote below local_count/this is "significantly smaller"

count_records() {
  python3 -c "
import json, sys
try:
    print(len(json.load(open(sys.argv[1]))))
except Exception:
    print(0)
" "$1" 2>/dev/null || echo 0
}

# Compares data/<name> (last known good) against a freshly-fetched remote copy.
# Returns 0 — caller should proceed with the normal pull (tmp_remote is the file
#             to pull from; may be empty if remote genuinely doesn't exist yet).
# Returns 1 — caller should do nothing further; this function already handled it
#             (pushed local to remote, or the whole deploy was aborted).
guard_remote_size() {
  local name="$1" local_file="$2" tmp_remote="$3"
  local local_count remote_count

  local_count=$(count_records "$local_file")
  remote_count=$([[ -s "$tmp_remote" ]] && count_records "$tmp_remote" || echo 0)

  # Nothing local worth protecting, or remote isn't meaningfully smaller — proceed.
  [[ "$local_count" -eq 0 ]] && return 0
  (( remote_count * SHRINK_GUARD_FACTOR >= local_count )) && return 0

  echo ""
  echo "  ┌─ POSSIBLE DATA LOSS: ${name}"
  if [[ -s "$tmp_remote" ]]; then
    echo "  │  Remote (about to pull): ${remote_count} record(s)"
  else
    echo "  │  Remote: missing or unreadable"
  fi
  echo "  │  Local  (last known good): ${local_count} record(s)"
  echo "  └──────────────────────────────────────────"

  if [[ ! -t 0 ]]; then
    die "${name}: refusing to auto-pull a shrunk/missing remote file — not an interactive terminal to confirm. Re-run interactively (or investigate the remote copy directly) before deploying."
  fi

  echo "     [P] Pull remote anyway (accept the smaller/missing data)"
  echo "     [K] Keep local — push it to remote instead (remote looks like the one that's wrong)"
  echo "     [A] Abort deploy"
  while true; do
    read -r -p "  Choice [P/K/A]: " choice
    case "$choice" in
      [Pp]) return 0 ;;
      [Kk])
        $SCP "$local_file" "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" \
          || die "Failed to push ${name} to remote"
        echo "  ${name}: pushed local to remote"
        return 1 ;;
      [Aa]) die "Aborted during reconciliation of ${name}" ;;
      *) echo "  Please enter P, K, or A" ;;
    esac
  done
}

# Fetches remote, guards it, and on a pass copies it into data/<name> (backed up).
guarded_pull() {
  local name="$1" default="$2"
  local local_file="data/${name}"
  local tmp_remote="/tmp/wishlist-guard-${name}"

  [[ -f "$local_file" ]] || echo "$default" > "$local_file"

  $SCP "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" "$tmp_remote" 2>/dev/null || : > "$tmp_remote"

  if ! guard_remote_size "$name" "$local_file" "$tmp_remote"; then
    rm -f "$tmp_remote"
    return
  fi

  if [[ -s "$tmp_remote" ]]; then
    cp "$tmp_remote" "$local_file"
    cp "$local_file" "${BACKUP_DIR}/${name}"
    echo "  ${name}: pulled from remote"
  else
    echo "  ${name}: not on server yet — using local default"
  fi
  rm -f "$tmp_remote"
}

reconcile_remote_authoritative() {
  local name="$1" default="$2"
  local local_file="data/${name}"

  [[ -f "$local_file" ]] || echo "$default" > "$local_file"
  cp "$local_file" "${BACKUP_DIR}/${name}.local"

  if [[ "$PREFER_LOCAL" == "1" ]]; then
    echo "  ${name}: PREFER_LOCAL=1 — pushing local to remote"
    $SCP "$local_file" "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}"
    return
  fi

  guarded_pull "$name" "$default"
}

# Pull-only, no override — nothing legitimately writes this file locally.
pull_data_file() {
  guarded_pull "$1" "$2"
}

# Bidirectional ID-keyed merge (same scheme as investmentoptimizer/family-calendar):
# records present on only one side are kept; records present on both sides are
# resolved by updatedAt > createdAt timestamp (local wins strictly; on tie remote
# wins). Used for feature-requests.json — admin edits (status/flagged/adminNote)
# can happen locally via a script as well as live in the app, so a plain
# remote-wins pull would silently drop those local edits.

MERGE_PY='
import json, sys
local_path, remote_path, merged_path, sort_key = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(local_path)  as f: local_list  = json.load(f)
with open(remote_path) as f: remote_list = json.load(f)
local_map  = {r["id"]: r for r in local_list}
remote_map = {r["id"]: r for r in remote_list}
merged = {}
for rid, rec in remote_map.items():
    if rid not in local_map:
        merged[rid] = rec
for rid, rec in local_map.items():
    if rid not in remote_map:
        merged[rid] = rec
for rid in set(local_map) & set(remote_map):
    local_ts  = local_map[rid].get("updatedAt")  or local_map[rid].get("createdAt")  or ""
    remote_ts = remote_map[rid].get("updatedAt") or remote_map[rid].get("createdAt") or ""
    merged[rid] = local_map[rid] if local_ts > remote_ts else remote_map[rid]
result = sorted(merged.values(), key=lambda r: r.get(sort_key) or "")
new_r = sum(1 for r in remote_map if r not in local_map)
new_l = sum(1 for r in local_map  if r not in remote_map)
kept_l = sum(1 for r in set(local_map) & set(remote_map)
             if (local_map[r].get("updatedAt") or local_map[r].get("createdAt") or "") >
                (remote_map[r].get("updatedAt") or remote_map[r].get("createdAt") or ""))
kept_r = len(set(local_map) & set(remote_map)) - kept_l
with open(merged_path, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
print(f"  +{new_r} from server, +{new_l} from local, {kept_l} local edits kept, {kept_r} server edits kept → {len(result)} total")
'

merge_json() {
  local name="$1" sort_key="$2" default="$3"
  local local_file="data/${name}"
  local tmp_remote="/tmp/wishlist-merge-remote-${name}"
  local tmp_merged="/tmp/wishlist-merge-merged-${name}"

  echo "  reconciling ${name}..."

  if ! $SCP "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" "$tmp_remote" 2>/dev/null; then
    echo "    ${name}: not on server yet — pushing local"
    [[ -f "$local_file" ]] || echo "$default" > "$local_file"
    $SCP "$local_file" "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" || true
    return
  fi

  [[ -f "$local_file" ]] || echo "$default" > "$local_file"

  python3 - "$local_file" "$tmp_remote" "$tmp_merged" "$sort_key" <<< "$MERGE_PY"
  cp "$tmp_merged" "$local_file"
  cp "$local_file" "${BACKUP_DIR}/${name}"
  $SCP "$local_file" "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}"
  rm -f "$tmp_remote" "$tmp_merged"
}

# ── Backup + reconcile/pull all data files ────────────────────────────────────

BACKUP_DIR="data/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Reconciling data files (backup → ${BACKUP_DIR})..."

# Real user data, only ever written by the live app. Remote wins by default.
reconcile_remote_authoritative "wishlist-items.json" "[]"

# Bidirectional — admin triage (status/flagged/adminNote) can happen locally too.
merge_json "feature-requests.json" "createdAt" "[]"

# Server-only writes (syncUser + admin panel edits) — never overridden by PREFER_LOCAL.
pull_data_file "users.json" "[]"

echo "Data sync complete. Backup: ${BACKUP_DIR}"

# ── Build Docker image ────────────────────────────────────────────────────────

echo "Building Docker image..."
docker build --platform linux/amd64 \
  --build-arg VITE_BASE_PATH=/wishlist/ \
  -t wishlist:latest .

echo "Saving image..."
docker save wishlist:latest | gzip > /tmp/wishlist.tar.gz

# ── Transfer files ────────────────────────────────────────────────────────────

echo "Transferring image..."
$SCP /tmp/wishlist.tar.gz ${REMOTE_USER}@${REMOTE_HOST}:/tmp/wishlist.tar.gz

echo "Transferring compose file..."
$SSH "mkdir -p ${REMOTE_DIR}"
$SCP docker-compose-lightsail.yml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/docker-compose.yml

# ── Deploy ────────────────────────────────────────────────────────────────────

echo "Loading image on remote..."
$SSH "docker load < /tmp/wishlist.tar.gz && rm /tmp/wishlist.tar.gz"

echo "Restarting container..."
$SSH "cd ${REMOTE_DIR} && docker compose down && docker compose up -d"

echo "Done! wishlist deployed to ${REMOTE_HOST}"
