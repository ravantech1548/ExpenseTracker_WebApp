import { useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Config from './pages/Config.jsx';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState('home');

  const loadUser = () => api('/me').then((r) => setUser(r.data)).catch(() => setUser(null));
  useEffect(() => { loadUser(); }, []);

  if (user === undefined) return null;
  if (!user) return <Login onLogin={loadUser} />;

  const logout = async () => {
    await api('/logout', { method: 'POST' });
    setUser(null);
    setPage('home');
  };

  return (
    <>
      <header className="topbar">
        <span className="brand">Family Expense Tracker</span>
        <nav>
          <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>Home</button>
          {user.role === 'admin' && (
            <button className={page === 'config' ? 'active' : ''} onClick={() => setPage('config')}>Configuration</button>
          )}
        </nav>
        <span className="who">
          {user.name}
          <button className="link" onClick={logout}>Log out</button>
        </span>
      </header>
      <main>
        {page === 'home' && (
          <div className="card">
            <h2>Welcome, {user.name}</h2>
            <p>Expenses and the dashboard arrive in the next slices.</p>
          </div>
        )}
        {page === 'config' && <Config />}
      </main>
    </>
  );
}
