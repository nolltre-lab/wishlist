import React, { useState, useEffect } from 'react';
import LocalUserPicker from './components/LocalUserPicker.jsx';
import ItemModal from './components/ItemModal.jsx';
import WishlistView from './components/WishlistView.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import FeatureRequestButton from './components/FeatureRequestButton.jsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export async function apiFetch(path, opts) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [localUsers, setLocalUsers] = useState([]);
  const [members, setMembers] = useState([]);
  const [accessibleUsers, setAccessibleUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('mine');
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null); // { mode: 'new' | 'edit', item? }
  const [showAdmin, setShowAdmin] = useState(false);
  const [myRequests, setMyRequests] = useState([]);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/me').catch(() => null),
      apiFetch('/api/local-users').catch(() => []),
    ]).then(([me, lu]) => {
      setLocalUsers(lu || []);
      setUser(me);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    apiFetch('/api/members').then(setMembers).catch(() => {});
    apiFetch('/api/wishlist/accessible-users').then(setAccessibleUsers).catch(() => {});
    apiFetch('/api/feature-requests').then(setMyRequests).catch(() => {});
    setActiveTab('mine');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const target = activeTab === 'mine' ? user.username : activeTab;
    apiFetch(`/api/wishlist/${target}`).then(setItems).catch(() => setItems([]));
  }, [user, activeTab]);

  const nameFor = (username) => members.find(m => m.username === username)?.displayName || username;

  const reloadCurrentList = () => {
    const target = activeTab === 'mine' ? user.username : activeTab;
    apiFetch(`/api/wishlist/${target}`).then(setItems).catch(() => {});
  };

  const handleLocalLogin = async (username) => {
    await apiFetch('/api/local-login', { method: 'POST', body: JSON.stringify({ username }) });
    const me = await apiFetch('/api/me');
    setUser(me);
  };

  const handleLocalLogout = async () => {
    await apiFetch('/api/local-logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setMembers([]);
    setAccessibleUsers([]);
    setItems([]);
    setMyRequests([]);
  };

  const saveItem = async (data) => {
    if (modal?.mode === 'edit') {
      await apiFetch(`/api/wishlist/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/wishlist', { method: 'POST', body: JSON.stringify(data) });
    }
    reloadCurrentList();
    setModal(null);
  };

  const deleteItem = async (id) => {
    if (!window.confirm('Ta bort önskningen?')) return;
    await apiFetch(`/api/wishlist/${id}`, { method: 'DELETE' });
    reloadCurrentList();
  };

  const moveItem = async (id, direction) => {
    const idx = items.findIndex(i => i.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const reordered = [...items];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    setItems(reordered);
    try {
      await apiFetch('/api/wishlist/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: reordered.map(i => i.id) }),
      });
    } catch {
      reloadCurrentList();
    }
  };

  const reserveItem = async (id, reserved) => {
    try {
      await apiFetch(`/api/wishlist/${id}/reserve`, { method: 'PUT', body: JSON.stringify({ reserved }) });
      reloadCurrentList();
    } catch (err) {
      alert(err.message.includes('409') || /already reserved/i.test(err.message)
        ? 'Någon annan har redan reserverat den här.'
        : 'Något gick fel.');
      reloadCurrentList();
    }
  };

  if (loading) return <div className="loading">Laddar...</div>;

  if (!user && localUsers.length > 0) {
    return <LocalUserPicker users={localUsers} onLogin={handleLocalLogin} />;
  }

  if (!user) return <div className="loading">Laddar...</div>;

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">🎁 Önskelistan</span>
        {localUsers.length > 0 ? (
          <button className="app-user-switch" onClick={handleLocalLogout} title="Byt användare">
            {user.username}
          </button>
        ) : (
          <span className="app-user">{user.username}</span>
        )}
      </header>

      <div className="cal-filter-bar">
        <button
          className={`cal-filter-pill${activeTab === 'mine' ? ' active' : ''}`}
          onClick={() => setActiveTab('mine')}
        >
          Min lista
        </button>
        {accessibleUsers.map(u => (
          <button
            key={u.username}
            className={`cal-filter-pill${activeTab === u.username ? ' active' : ''}`}
            style={activeTab === u.username ? { background: u.color, borderColor: u.color, color: '#fff' } : { borderColor: u.color, color: u.color }}
            onClick={() => setActiveTab(u.username)}
          >
            {u.displayName}
          </button>
        ))}
        {user.role === 'admin' && (
          <button className="settings-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowAdmin(true)}>
            Admin
          </button>
        )}
      </div>

      {accessibleUsers.length === 0 && user.role !== 'admin' && (
        <div className="setup-hint">
          Du kan bara se din egen lista just nu. Be en admin om att dela andras önskelistor med dig.
        </div>
      )}

      <main className="wl-main">
        <WishlistView
          items={items}
          mode={activeTab === 'mine' ? 'own' : 'view'}
          nameFor={nameFor}
          currentUsername={user.username}
          onEdit={(item) => setModal({ mode: 'edit', item })}
          onDelete={deleteItem}
          onMove={moveItem}
          onReserve={reserveItem}
          onAdd={() => setModal({ mode: 'new' })}
        />
      </main>

      {modal && (
        <ItemModal
          item={modal.mode === 'edit' ? modal.item : null}
          onSave={saveItem}
          onDelete={modal.mode === 'edit' ? () => { deleteItem(modal.item.id); setModal(null); } : null}
          onClose={() => setModal(null)}
        />
      )}

      {showAdmin && <AdminPanel onClose={() => {
        setShowAdmin(false);
        apiFetch('/api/wishlist/accessible-users').then(setAccessibleUsers).catch(() => {});
        apiFetch('/api/members').then(setMembers).catch(() => {});
      }} />}

      <FeatureRequestButton
        page="wishlist"
        myRequests={myRequests}
        isAdmin={user.role === 'admin'}
        onSubmitted={() => apiFetch('/api/feature-requests').then(setMyRequests).catch(() => {})}
      />
    </div>
  );
}
