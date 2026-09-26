import React from 'react';

function fmtPrice(price) {
  if (price === null || price === undefined) return null;
  return `${Number(price).toLocaleString('sv-SE')} kr`;
}

export default function WishlistView({ items, mode, nameFor, currentUsername, onEdit, onDelete, onMove, onReserve, onAdd }) {
  if (items.length === 0) {
    return (
      <div className="wl-empty">
        {mode === 'own' ? (
          <>
            <p>Din önskelista är tom ännu.</p>
            <button className="btn" onClick={onAdd}>+ Lägg till en önskning</button>
          </>
        ) : (
          <p>Den här listan är tom ännu.</p>
        )}
      </div>
    );
  }

  return (
    <div className="wl-list">
      {mode === 'own' && (
        <button className="btn wl-add-btn" onClick={onAdd}>+ Lägg till en önskning</button>
      )}

      {items.map((item, i) => (
        <div key={item.id} className="wl-card">
          <div className="wl-card-main">
            <div className="wl-card-top">
              <span className="wl-card-title">{item.title}</span>
              {fmtPrice(item.price) && <span className="wl-card-price">{fmtPrice(item.price)}</span>}
            </div>
            {item.description && <p className="wl-card-desc">{item.description}</p>}
            {item.link && (
              <a className="wl-card-link" href={item.link} target="_blank" rel="noopener noreferrer">
                Visa exempel ↗
              </a>
            )}
          </div>

          {mode === 'own' ? (
            <div className="wl-card-actions">
              <button className="icon-btn" disabled={i === 0} onClick={() => onMove(item.id, -1)} title="Flytta upp">↑</button>
              <button className="icon-btn" disabled={i === items.length - 1} onClick={() => onMove(item.id, 1)} title="Flytta ner">↓</button>
              <button className="icon-btn" onClick={() => onEdit(item)} title="Redigera">✏</button>
              <button className="icon-btn" onClick={() => onDelete(item.id)} title="Ta bort">✕</button>
            </div>
          ) : (
            <div className="wl-card-actions">
              {!item.reservedBy && (
                <button className="btn wl-reserve-btn" onClick={() => onReserve(item.id, true)}>Reservera</button>
              )}
              {item.reservedBy === currentUsername && (
                <>
                  <span className="wl-reserved-badge wl-reserved-mine">✓ Reserverad av dig</span>
                  <button className="btn btn-ghost" onClick={() => onReserve(item.id, false)}>Avboka</button>
                </>
              )}
              {item.reservedBy && item.reservedBy !== currentUsername && (
                <span className="wl-reserved-badge">Reserverad av {nameFor(item.reservedBy)}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
