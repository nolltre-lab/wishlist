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
# Remote (Lightsail) is authoritative by default: local is always backed up
# first, then overwritten with the remote version. PREFER_LOCAL=1 flips a
# single file to push-local-instead, for deliberate local data clean-up.

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

  echo "  ${name}: pulling from remote (authoritative; local kept as backup)..."
  if $SCP "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" "$local_file" 2>/dev/null; then
    cp "$local_file" "${BACKUP_DIR}/${name}"
  else
    echo "    ${name}: not on server yet — pushing local default"
    $SCP "$local_file" "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" || true
  fi
}

# Pull-only, no override — nothing legitimately writes this file locally.
pull_data_file() {
  local name="$1" default="$2"
  echo "  pulling ${name}..."
  if $SCP "${REMOTE_USER}@${REMOTE_HOST}:${DATA_DIR}/${name}" "data/${name}" 2>/dev/null; then
    cp "data/${name}" "${BACKUP_DIR}/${name}"
  else
    echo "    ${name}: not on server yet — using local default"
    echo "$default" > "data/${name}"
  fi
}

# ── Backup + reconcile/pull all data files ────────────────────────────────────

BACKUP_DIR="data/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Reconciling data files (backup → ${BACKUP_DIR})..."

# Real user data — created by people using the live app. Remote wins by default.
reconcile_remote_authoritative "wishlist-items.json" "[]"
reconcile_remote_authoritative "feature-requests.json" "[]"

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
