import React from 'react';

const PALETTE = ['#818cf8', '#06b6d4', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#f87171', '#94a3b8'];

export default function LocalUserPicker({ users, onLogin }) {
  return (
    <div className="picker-overlay">
      <div className="picker-card">
        <h1 className="picker-title">Önskelistan</h1>
        <p className="picker-subtitle">Vem är du?</p>
        <div className="picker-grid">
          {users.map((u, i) => {
            const color = PALETTE[i % PALETTE.length];
            const initials = u.username.slice(0, 2).toUpperCase();
            return (
              <button key={u.username} className="picker-user-btn" onClick={() => onLogin(u.username)}>
                <div className="picker-avatar" style={{ background: color }}>{initials}</div>
                <span className="picker-name">{u.username}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
