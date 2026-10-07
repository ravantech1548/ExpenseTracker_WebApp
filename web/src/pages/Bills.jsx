import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Local date as YYYY-MM-DD (toISOString alone would give the UTC date).
const localDate = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

const monthLabel = (month) =>
  new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const money = (n, currency) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;

const emptyBill = {
  name: '', category_id: '', provider_id: '', member_id: '', currency: 'SGD', usual_amount: '', due_day: '', payment_mode_id: '', active: true,
};

export default function Bills() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [lookups, setLookups] = useState(null);
  const [checklist, setChecklist] = useState([]);
  const [bills, setBills] = useState([]);
  const [pay, setPay] = useState({}); // per bill: { amount, payment_mode_id, paid_on }
  const [form, setForm] = useState(emptyBill);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  const loadChecklist = () =>
    api('/bills/checklist?month=' + month)
      .then((r) => {
        setChecklist(r.data);
        setPay(Object.fromEntries(r.data.map((b) => [b.id, {
          amount: b.suggested_amount ?? '', payment_mode_id: b.payment_mode_id ?? '', paid_on: localDate(),
        }])));
      })
      .catch((e) => setError(e.message));
  const loadBills = () => api('/bills').then((r) => setBills(r.data)).catch((e) => setError(e.message));

  useEffect(() => { api('/lookups').then((r) => setLookups(r.data)).catch((e) => setError(e.message)); loadBills(); }, []);
  useEffect(() => { loadChecklist(); }, [month]);

  if (!lookups) return error ? <p className="error">{error}</p> : null;

  const byId = (list, id) => list.find((x) => x.id === id);
  const category = (id) => byId(lookups.categories, id);
  const who = (memberId) => (memberId ? byId(lookups.members, memberId)?.name : 'Family');
  const today = localDate();
  const setPayField = (id, field, value) => setPay({ ...pay, [id]: { ...pay[id], [field]: value } });

  async function markPaid(b) {
    setError('');
    try {
      await api(`/bills/${b.id}/pay`, { method: 'POST', body: { month, ...pay[b.id] } });
      loadChecklist();
    } catch (err) {
      setError(err.message);
    }
  }

  async function undoPaid(b) {
    if (!confirm(`Mark "${b.name}" as not paid? Its expense will be deleted.`)) return;
    setError('');
    try {
      await api('/expenses/' + b.expense_id, { method: 'DELETE' });
      loadChecklist();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveBill(e) {
    e.preventDefault();
    setFormError('');
    try {
      if (editing === null) await api('/bills', { method: 'POST', body: form });
      else await api('/bills/' + editing, { method: 'PUT', body: form });
      setForm(emptyBill);
      setEditing(null);
      loadBills();
      loadChecklist();
    } catch (err) {
      setFormError(err.message);
    }
  }

  function editBill(b) {
    setEditing(b.id);
    setForm(Object.fromEntries(Object.keys(emptyBill).map((k) => [k, b[k] ?? ''])));
  }

  async function removeBill(b) {
    if (!confirm(`Delete the bill "${b.name}"? Past payments stay in Expenses.`)) return;
    setFormError('');
    try {
      await api('/bills/' + b.id, { method: 'DELETE' });
      loadBills();
      loadChecklist();
    } catch (err) {
      setFormError(err.message);
    }
  }

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const providers = lookups.providers.filter((p) => !form.category_id || !p.category_id || p.category_id === Number(form.category_id));
  const paidCount = checklist.filter((b) => b.expense_id).length;

  return (
    <div className="expenses">
      <div className="month-bar">
        <button className="link" onClick={() => setMonth(shiftMonth(month, -1))}>‹ Previous</button>
        <h2>Bills for {monthLabel(month)}</h2>
        <button className="link" onClick={() => setMonth(shiftMonth(month, 1))}>Next ›</button>
      </div>

      <section className="card">
        <h3>Checklist ({paidCount} of {checklist.length} paid)</h3>
        {checklist.length === 0 ? <p className="hint">No bills set up yet. Add your monthly bills below.</p> : (
          <table>
            <thead>
              <tr><th>Due</th><th>Bill</th><th>For</th><th>Status</th><th className="num">Amount</th><th>Payment mode</th><th>Paid on</th><th /></tr>
            </thead>
            <tbody>
              {checklist.map((b) => {
                const c = category(b.category_id);
                const overdue = !b.expense_id && b.due_on < today;
                const p = pay[b.id] || {};
                return (
                  <tr key={b.id} className={overdue ? 'overdue' : ''}>
                    <td>{b.due_on}</td>
                    <td><span className="swatch-row"><span className="swatch" style={{ background: c?.colour || 'transparent' }} />{b.name}</span></td>
                    <td>{who(b.member_id)}</td>
                    <td>
                      {b.expense_id
                        ? <span className="status active">Paid</span>
                        : <span className={'status ' + (overdue ? 'overdue' : 'pending')}>{overdue ? 'Overdue' : 'Due'}</span>}
                    </td>
                    {b.expense_id ? (
                      <>
                        <td className="num">{money(b.paid_amount, b.paid_currency)}</td>
                        <td>{byId(lookups.paymentModes, b.paid_payment_mode_id)?.name}</td>
                        <td>{b.paid_on}</td>
                        <td className="actions"><button className="link danger" onClick={() => undoPaid(b)}>Undo</button></td>
                      </>
                    ) : (
                      <>
                        <td className="num">
                          <span className="amount-input">
                            <input type="number" step="0.01" min="0.01" value={p.amount} onChange={(e) => setPayField(b.id, 'amount', e.target.value)} />
                            {b.currency}
                          </span>
                        </td>
                        <td>
                          <select value={p.payment_mode_id} onChange={(e) => setPayField(b.id, 'payment_mode_id', e.target.value)}>
                            <option value="">Choose…</option>
                            {lookups.paymentModes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                        <td><input type="date" value={p.paid_on} onChange={(e) => setPayField(b.id, 'paid_on', e.target.value)} /></td>
                        <td className="actions"><button className="primary small" onClick={() => markPaid(b)}>Mark paid</button></td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h3>Monthly bills</h3>
        {bills.length > 0 && (
          <table>
            <thead>
              <tr><th>Due day</th><th>Bill</th><th>Category</th><th>For</th><th className="num">Usual amount</th><th>Active</th><th /></tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td>{b.due_day}</td>
                  <td>{b.name}{b.provider_id ? ` (${byId(lookups.providers, b.provider_id)?.name})` : ''}</td>
                  <td>{category(b.category_id)?.name}</td>
                  <td>{who(b.member_id)}</td>
                  <td className="num">{b.usual_amount ? money(b.usual_amount, b.currency) : b.currency}</td>
                  <td>{b.active ? 'Yes' : 'No'}</td>
                  <td className="actions">
                    <button className="link" onClick={() => editBill(b)}>Edit</button>
                    <button className="link danger" onClick={() => removeBill(b)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form className="bill-form" onSubmit={saveBill}>
          <h3>{editing === null ? 'Add a monthly bill' : 'Edit bill'}</h3>
          <div className="grid">
            <label>Name<input value={form.name} onChange={set('name')} placeholder="e.g. Sara mobile" required /></label>
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
            <label>For
              <select value={form.member_id} onChange={set('member_id')}>
                <option value="">Family (common)</option>
                {lookups.members.map((m) => <option key={m.id} value={m.id}>{m.name} (personal)</option>)}
              </select>
            </label>
            <label>Due day of month<input type="number" min="1" max="31" value={form.due_day} onChange={set('due_day')} required /></label>
            <label>Currency
              <select value={form.currency} onChange={set('currency')} required>
                {lookups.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
            <label>Usual amount (optional)<input type="number" step="0.01" min="0.01" value={form.usual_amount} onChange={set('usual_amount')} /></label>
            <label>Usual payment mode
              <select value={form.payment_mode_id} onChange={set('payment_mode_id')}>
                <option value="">(none)</option>
                {lookups.paymentModes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (show in the monthly checklist)
          </label>
          <div className="form-actions">
            <button type="submit" className="primary">{editing === null ? 'Add bill' : 'Save'}</button>
            {editing !== null && <button type="button" className="link" onClick={() => { setEditing(null); setForm(emptyBill); }}>Cancel</button>}
          </div>
          {formError && <p className="error">{formError}</p>}
        </form>
      </section>
    </div>
  );
}
