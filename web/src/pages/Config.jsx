import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Configuration lists. Each field: name, label, and optional type.
const LISTS = [
  { id: 'family-members', label: 'Family members', key: 'id', fields: [{ name: 'name', label: 'Name' }] },
  {
    id: 'categories', label: 'Categories', key: 'id',
    fields: [{ name: 'name', label: 'Name' }, { name: 'colour', label: 'Colour', type: 'colour' }],
  },
  {
    id: 'providers', label: 'Service providers', key: 'id',
    fields: [{ name: 'name', label: 'Name' }, { name: 'category_id', label: 'Category', type: 'category' }],
  },
  { id: 'payment-modes', label: 'Payment modes', key: 'id', fields: [{ name: 'name', label: 'Name' }] },
  {
    id: 'currencies', label: 'Currencies', key: 'code',
    fields: [{ name: 'code', label: 'Code' }, { name: 'name', label: 'Name' }],
  },
];

export default function Config() {
  const [tab, setTab] = useState(LISTS[0].id);
  return (
    <div className="config">
      <aside className="card menu">
        <h3>Configuration</h3>
        {LISTS.map((l) => (
          <button key={l.id} className={tab === l.id ? 'active' : ''} onClick={() => setTab(l.id)}>{l.label}</button>
        ))}
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>
      </aside>
      <section className="card content">
        {tab === 'users' ? <Users /> : <ListEditor key={tab} list={LISTS.find((l) => l.id === tab)} />}
      </section>
    </div>
  );
}

function ListEditor({ list }) {
  const empty = Object.fromEntries(list.fields.map((f) => [f.name, '']));
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/config/' + list.id).then((r) => setRows(r.data)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    if (list.fields.some((f) => f.type === 'category')) api('/config/categories').then((r) => setCategories(r.data));
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      if (editing === null) await api('/config/' + list.id, { method: 'POST', body: form });
      else await api(`/config/${list.id}/${encodeURIComponent(editing)}`, { method: 'PUT', body: form });
      setForm(empty);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(row) {
    if (!confirm(`Delete "${row[list.fields[0].name]}"?`)) return;
    setError('');
    try {
      await api(`/config/${list.id}/${encodeURIComponent(row[list.key])}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function edit(row) {
    setEditing(row[list.key]);
    setForm(Object.fromEntries(list.fields.map((f) => [f.name, row[f.name] ?? ''])));
  }

  function show(field, row) {
    const v = row[field.name];
    if (field.type === 'colour') {
      return v ? <span className="swatch-row"><span className="swatch" style={{ background: v }} />{v}</span> : 'Unknown';
    }
    if (field.type === 'category') return categories.find((c) => c.id === v)?.name ?? '';
    return v;
  }

  function input(field) {
    const value = form[field.name];
    const set = (v) => setForm({ ...form, [field.name]: v });
    if (field.type === 'category') {
      return (
        <select value={value} onChange={(e) => set(e.target.value)}>
          <option value="">(none)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      );
    }
    if (field.type === 'colour') {
      return (
        <span className="colour-input">
          <input type="color" value={value || '#ffffff'} onChange={(e) => set(e.target.value)} />
          <input value={value} placeholder="Unknown" onChange={(e) => set(e.target.value)} />
        </span>
      );
    }
    return <input value={value} onChange={(e) => set(e.target.value)} required={field === list.fields[0]} />;
  }

  return (
    <>
      <h2>{list.label}</h2>
      <table>
        <thead>
          <tr>{list.fields.map((f) => <th key={f.name}>{f.label}</th>)}<th /></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[list.key]}>
              {list.fields.map((f) => <td key={f.name}>{show(f, row)}</td>)}
              <td className="actions">
                <button className="link" onClick={() => edit(row)}>Edit</button>
                <button className="link danger" onClick={() => remove(row)}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={list.fields.length + 1} className="hint">Nothing added yet.</td></tr>}
        </tbody>
      </table>
      <form className="add-form" onSubmit={save}>
        {list.fields.map((f) => <label key={f.name}>{f.label}{input(f)}</label>)}
        <button type="submit" className="primary">{editing === null ? 'Add' : 'Save'}</button>
        {editing !== null && (
          <button type="button" className="link" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>
        )}
      </form>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Users() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const load = () => api('/users').then((r) => setRows(r.data)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function setStatus(id, status) {
    setError('');
    try {
      await api(`/users/${id}/status`, { method: 'PUT', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/users', { method: 'POST', body: { email, name } });
      setEmail('');
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h2>Users</h2>
      <p className="hint">
        Add a Gmail address to approve it in advance, so that person can sign in with Google straight away.
        People who apply themselves appear here as "pending" until you approve them.
      </p>
      <table>
        <thead>
          <tr><th>Name</th><th>Login</th><th>Role</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.username || u.email}</td>
              <td>{u.role}</td>
              <td><span className={'status ' + u.status}>{u.status}</span></td>
              <td className="actions">
                {u.role !== 'admin' && u.status !== 'active' && (
                  <button className="link" onClick={() => setStatus(u.id, 'active')}>Approve</button>
                )}
                {u.role !== 'admin' && u.status !== 'rejected' && (
                  <button className="link danger" onClick={() => setStatus(u.id, 'rejected')}>
                    {u.status === 'active' ? 'Disable' : 'Reject'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="add-form" onSubmit={add}>
        <label>Gmail address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="submit" className="primary">Add approved user</button>
      </form>
      {error && <p className="error">{error}</p>}
    </>
  );
}
