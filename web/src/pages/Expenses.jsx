import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Local date as YYYY-MM-DD (toISOString alone would give the UTC date).
const localDate = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const today = localDate;
const emptyForm = () => ({
  spent_on: today(), category_id: '', provider_id: '', amount: '', currency: 'SGD', payment_mode_id: '', member_id: '',
});

function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const monthLabel = (month) =>
  new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const money = (n, currency) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;

export default function Expenses() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [expenses, setExpenses] = useState([]);
  const [lookups, setLookups] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/expenses?month=' + month).then((r) => setExpenses(r.data.expenses)).catch((e) => setError(e.message));
  useEffect(() => { api('/lookups').then((r) => setLookups(r.data)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [month]);

  if (!lookups) return error ? <p className="error">{error}</p> : null;

  const byId = (list, id) => list.find((x) => x.id === id);
  const category = (id) => byId(lookups.categories, id);
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      if (editing === null) await api('/expenses', { method: 'POST', body: form });
      else await api('/expenses/' + editing, { method: 'PUT', body: form });
      // Keep date, currency and payment mode for quick entry of several bills.
      setForm({ ...emptyForm(), spent_on: form.spent_on, currency: form.currency, payment_mode_id: form.payment_mode_id });
      setEditing(null);
      setMonth(form.spent_on.slice(0, 7));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function edit(x) {
    setEditing(x.id);
    setForm(Object.fromEntries(Object.keys(emptyForm()).map((k) => [k, x[k] ?? ''])));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(x) {
    if (!confirm(`Delete this ${money(x.amount, x.currency)} expense?`)) return;
    setError('');
    try {
      await api('/expenses/' + x.id, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Totals per category, kept separate per currency (no conversion yet).
  const totals = {};
  for (const x of expenses) {
    const key = x.category_id;
    totals[key] ??= {};
    totals[key][x.currency] = (totals[key][x.currency] || 0) + Number(x.amount);
  }
  const grand = {};
  for (const x of expenses) grand[x.currency] = (grand[x.currency] || 0) + Number(x.amount);

  const providers = lookups.providers.filter((p) => !form.category_id || !p.category_id || p.category_id === Number(form.category_id));

  return (
    <div className="expenses">
      <form className="card expense-form" onSubmit={save}>
        <h2>{editing === null ? 'Add an expense' : 'Edit expense'}</h2>
        <div className="grid">
          <label>Date<input type="date" value={form.spent_on} onChange={set('spent_on')} required /></label>
          <label>Category
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value, provider_id: '' })} required>
              <option value="">Choose…</option>
              {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Service provider
            <select value={form.provider_id} onChange={set('provider_id')}>
              <option value="">(none)</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Amount<input type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} required /></label>
          <label>Currency
            <select value={form.currency} onChange={set('currency')} required>
              {lookups.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <label>Payment mode
            <select value={form.payment_mode_id} onChange={set('payment_mode_id')}>
              <option value="">(none)</option>
              {lookups.paymentModes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>For
            <select value={form.member_id} onChange={set('member_id')}>
              <option value="">Family (common)</option>
              {lookups.members.map((m) => <option key={m.id} value={m.id}>{m.name} (personal)</option>)}
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary">{editing === null ? 'Add expense' : 'Save'}</button>
          {editing !== null && (
            <button type="button" className="link" onClick={() => { setEditing(null); setForm(emptyForm()); }}>Cancel</button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      <div className="month-bar">
        <button className="link" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹ Previous</button>
        <h2>{monthLabel(month)}</h2>
        <button className="link" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">Next ›</button>
      </div>

      <section className="card">
        <h3>Total by category</h3>
        {expenses.length === 0 ? <p className="hint">No expenses this month.</p> : (
          <table>
            <thead><tr><th>Category</th>{Object.keys(grand).map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
            <tbody>
              {Object.entries(totals).map(([id, byCur]) => {
                const c = category(Number(id));
                return (
                  <tr key={id}>
                    <td><span className="swatch-row"><span className="swatch" style={{ background: c?.colour || 'transparent' }} />{c?.name}</span></td>
                    {Object.keys(grand).map((cur) => <td key={cur} className="num">{byCur[cur] ? money(byCur[cur], cur) : ''}</td>)}
                  </tr>
                );
              })}
              <tr className="total-row">
                <td>Total</td>
                {Object.entries(grand).map(([cur, n]) => <td key={cur} className="num">{money(n, cur)}</td>)}
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>Expenses</h3>
        {expenses.length > 0 && (
          <table>
            <thead>
              <tr><th>Date</th><th>Category</th><th>Provider</th><th>For</th><th>Payment</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {expenses.map((x) => {
                const c = category(x.category_id);
                return (
                  <tr key={x.id}>
                    <td>{x.spent_on}</td>
                    <td><span className="swatch-row"><span className="swatch" style={{ background: c?.colour || 'transparent' }} />{c?.name}</span></td>
                    <td>{byId(lookups.providers, x.provider_id)?.name}</td>
                    <td>{x.member_id ? byId(lookups.members, x.member_id)?.name : 'Family'}</td>
                    <td>{byId(lookups.paymentModes, x.payment_mode_id)?.name}</td>
                    <td className="num">{money(x.amount, x.currency)}</td>
                    <td className="actions">
                      <button className="link" onClick={() => edit(x)}>Edit</button>
                      <button className="link danger" onClick={() => remove(x)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
