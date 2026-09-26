import React, { useState } from 'react';

const STATUS_COLOR = {
  'open':          '#f59e0b',
  'in-progress':   '#3b82f6',
  'implemented':   '#8b5cf6',
  'done':          '#22c55e',
  'wont-fix':      '#64748b',
};
const STATUS_ORDER = { 'open': 0, 'in-progress': 1, 'implemented': 2, 'done': 3, 'wont-fix': 4 };
const STATUS_OPTIONS = ['open','in-progress','implemented','done','wont-fix'];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

async function apiFetch(path, opts) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

function sorted(list) {
  return [...list].sort((a, b) => {
    const sd = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (sd !== 0) return sd;
    // flagged first within same status
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || '#64748b';
  return (
    <span className="fr-badge" style={{ background: color + '22', color }}>
      {status}
    </span>
  );
}

function UserItem({ r }) {
  return (
    <div className="fr-item">
      <div className="fr-item-header">
        <span className="fr-item-text">{r.text}</span>
        <StatusBadge status={r.status} />
      </div>
      <div className="fr-item-meta">{new Date(r.createdAt).toLocaleDateString('sv-SE')}</div>
      {r.adminNote && <div className="fr-item-note">{r.adminNote}</div>}
      {r.commitRef && <div className="fr-item-meta" style={{ fontFamily: 'monospace' }}>{r.commitRef}</div>}
    </div>
  );
}

function AdminCard({ r, onPatch }) {
  return (
    <div className={`fr-admin-card${r.flagged ? ' flagged' : ''}`}>
      <div className="fr-admin-card-text">{r.text}</div>
      <div className="fr-admin-card-meta">
        {r.user} · {r.page || '–'} · {new Date(r.createdAt).toLocaleDateString('sv-SE')}
        {r.commitRef && <> · <span style={{ fontFamily: 'monospace' }}>{r.commitRef}</span></>}
      </div>
      {r.adminNote && <div className="fr-item-note">{r.adminNote}</div>}
      <div className="fr-admin-controls">
        <select value={r.status} onChange={e => onPatch(r.id, { status: e.target.value })}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          className={`flag-btn${r.flagged ? ' active' : ''}`}
          onClick={() => onPatch(r.id, { flagged: !r.flagged })}
        >
          ★ {r.flagged ? 'Flaggad' : 'Flagga'}
        </button>
      </div>
    </div>
  );
}

function SplitList({ items, renderItem }) {
  const s = sorted(items);
  const active   = s.filter(r => r.status !== 'done' && r.status !== 'wont-fix');
  const resolved = s.filter(r => r.status === 'done' || r.status === 'wont-fix');

  return (
    <>
      {active.length === 0 && resolved.length === 0 && (
        <div className="fr-empty">Inga förslag.</div>
      )}
      {active.map(r => renderItem(r))}
      {resolved.length > 0 && (
        <details style={{ marginTop: active.length ? '0.5rem' : 0 }}>
          <summary className="fr-resolved-summary">
            {resolved.length} avslutade
          </summary>
          <div style={{ marginTop: '0.5rem' }}>
            {resolved.map(r => renderItem(r))}
          </div>
        </details>
      )}
    </>
  );
}

export default function FeatureRequestButton({ page, myRequests, isAdmin, onSubmitted }) {
  const [open, setOpen]     = useState(false);
  const [tab, setTab]       = useState('new');
  const [text, setText]     = useState('');
  const [msg, setMsg]       = useState(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await apiFetch('/api/feature-requests', {
        method: 'POST',
        body: JSON.stringify({ text: text.trim(), page }),
      });
      setText('');
      setMsg({ ok: true, text: 'Skickat!' });
      onSubmitted?.();
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ ok: false, text: 'Misslyckades. Försök igen.' });
    } finally {
      setSending(false);
    }
  };

  const patchFR = async (id, patch) => {
    await apiFetch(`/api/feature-requests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    onSubmitted?.();
  };

  const flaggedCount = myRequests.filter(r => r.flagged && ['open','in-progress'].includes(r.status)).length;

  return (
    <>
      <button className="fr-fab" onClick={() => setOpen(true)} title="Förbättringsförslag">
        {flaggedCount > 0 ? `★${flaggedCount}` : '✦'}
      </button>

      {open && (
        <div className="fr-backdrop" onClick={() => setOpen(false)}>
          <div className="fr-sheet" onClick={e => e.stopPropagation()}>
            <div className="fr-tabs">
              <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>Nytt förslag</button>
              <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
                Mina {myRequests.length > 0 && !isAdmin ? `(${myRequests.length})` : ''}
              </button>
              {isAdmin && (
                <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
                  Alla {myRequests.length > 0 ? `(${myRequests.length})` : ''}
                </button>
              )}
              <button className="fr-close btn-ghost btn" onClick={() => setOpen(false)}>✕</button>
            </div>

            {tab === 'new' && (
              <div className="fr-form">
                <textarea
                  className="fr-textarea"
                  rows={4}
                  placeholder="Vad skulle du vilja förbättra?"
                  value={text}
                  onChange={e => setText(e.target.value)}
                />
                {msg && <div className={`fr-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
                <button className="btn fr-submit" onClick={submit} disabled={sending || !text.trim()}>
                  {sending ? 'Skickar...' : 'Skicka'}
                </button>
              </div>
            )}

            {tab === 'mine' && (
              <div className="fr-list">
                <SplitList
                  items={myRequests}
                  renderItem={r => <UserItem key={r.id} r={r} />}
                />
              </div>
            )}

            {tab === 'admin' && isAdmin && (
              <div className="fr-admin-list">
                <SplitList
                  items={myRequests}
                  renderItem={r => <AdminCard key={r.id} r={r} onPatch={patchFR} />}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
