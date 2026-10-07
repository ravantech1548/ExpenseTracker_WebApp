import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const googleButton = useRef(null);

  useEffect(() => {
    api('/config').then((r) => setGoogleClientId(r.data.googleClientId)).catch(() => {});
  }, []);

  // Load Google's sign-in button only when a client ID is configured.
  useEffect(() => {
    if (!googleClientId) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      window.google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogle });
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
    };
    document.body.appendChild(script);
    return () => script.remove();
  }, [googleClientId]);

  async function onGoogle({ credential }) {
    setError('');
    setNotice('');
    try {
      const r = await api('/login/google', { method: 'POST', body: { credential } });
      if (r.status === 202) setNotice(r.data.message);
      else onLogin();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api('/login', { method: 'POST', body: { username, password } });
      onLogin();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-page">
      <form className="card login" onSubmit={submit}>
        <h1>Family Expense Tracker</h1>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" className="primary">Log in</button>

        {googleClientId && (
          <>
            <div className="divider">or</div>
            <div ref={googleButton} className="google" />
            <p className="hint">New here? Continue with Google to apply. The admin approves new accounts.</p>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
      </form>
    </div>
  );
}
