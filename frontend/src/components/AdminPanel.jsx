import React, { useState, useEffect } from 'react';
import { apiFetch } from '../App.jsx';

const PROFILE_COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#60a5fa', '#818cf8',
  '#a78bfa', '#f472b6',
];

export default function AdminPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [editProfile, setEditProfile] = useState({}); // username → {displayName, color}

  useEffect(() => {
    apiFetch('/api/admin/users').then(u => {
      setUsers(u);
      const init = {};
      u.forEach(user => { init[user.username] = { displayName: user.displayName || '', color: user.color || '#94a3b8' }; });
      setEditProfile(init);
    }).catch(() => {});
  }, []);

  const saveProfile = async (username) => {
    const { displayName, color } = editProfile[username] || {};
    const updated = await apiFetch(`/api/admin/users/${username}`, {
      method: 'PUT',
      body: JSON.stringify({ displayName, color }),
    });
    setUsers(prev => prev.map(u => u.username === username ? updated : u));
  };

  const toggle = async (username, otherUsername, current) => {
    const user = users.find(u => u.username === username);
    const next = current
      ? (user.allowedWishlistUsers || []).filter(u => u !== otherUsername)
      : [...(user.allowedWishlistUsers || []), otherUsername];
    const updated = await apiFetch(`/api/admin/users/${username}`, {
      method: 'PUT',
      body: JSON.stringify({ allowedWishlistUsers: next }),
    });
    setUsers(prev => prev.map(u => u.username === username ? updated : u));
  };

  const remove = async (username) => {
    if (!window.confirm(`Ta bort ${username}? De kan synkas igen vid nästa inloggning.`)) return;
    await apiFetch(`/api/admin/users/${username}`, { method: 'DELETE' });
    setUsers(prev => prev.filter(u => u.username !== username));
  };

  const setField = (username, field, value) => {
    setEditProfile(prev => ({ ...prev, [username]: { ...prev[username], [field]: value } }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="day-detail-header">
          <h2>Administration</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {users.length === 0 ? (
          <p className="admin-empty">Inga användare har synkats än. De läggs till automatiskt när de loggar in.</p>
        ) : (
          <div className="admin-section">
            {users.map(user => {
              const ep = editProfile[user.username] || {};
              const others = users.filter(u => u.username !== user.username);
              return (
                <div key={user.username} className="admin-user-card">
                  <div className="admin-user-header">
                    <span className="cal-color-dot" style={{ background: ep.color || '#94a3b8' }} />
                    <span className="admin-user-name">{user.username}</span>
                    {user.role === 'admin' && <span className="admin-role-badge">admin</span>}
                    <button className="btn btn-danger admin-action-btn" style={{ marginLeft: 'auto' }} onClick={() => remove(user.username)}>✕</button>
                  </div>

                  <div className="admin-profile-row">
                    <input
                      className="admin-inline-input"
                      placeholder={`Visningsnamn (${user.username})`}
                      value={ep.displayName || ''}
                      onChange={e => setField(user.username, 'displayName', e.target.value)}
                    />
                    <div className="color-picker" style={{ flex: 'none' }}>
                      {PROFILE_COLORS.map(c => (
                        <button key={c} type="button"
                          className={`color-swatch${ep.color === c ? ' selected' : ''}`}
                          style={{ background: c }} onClick={() => setField(user.username, 'color', c)} />
                      ))}
                    </div>
                    <button className="btn" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={() => saveProfile(user.username)}>Spara</button>
                  </div>

                  {user.role === 'admin' ? (
                    <span className="admin-user-note">Admin ser alla listor automatiskt.</span>
                  ) : others.length === 0 ? (
                    <span className="admin-user-note">Inga andra användare att dela med ännu.</span>
                  ) : (
                    <>
                      <span className="admin-user-note" style={{ width: '100%', marginBottom: '0.25rem' }}>
                        Får se önskelistan för:
                      </span>
                      <div className="admin-cal-toggles">
                        {others.map(other => {
                          const has = (user.allowedWishlistUsers || []).includes(other.username);
                          const otherColor = other.color || '#94a3b8';
                          return (
                            <button
                              key={other.username}
                              className={`admin-cal-toggle${has ? ' active' : ''}`}
                              style={has ? { background: otherColor, borderColor: otherColor } : {}}
                              onClick={() => toggle(user.username, other.username, has)}
                            >
                              <span className="cal-color-dot" style={{ background: has ? '#fff' : otherColor }} />
                              {other.displayName || other.username}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
