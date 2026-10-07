import { useEffect, useState } from 'react';
import { api } from '../api.js';

const localMonth = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 7);
};

function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

const monthLabel = (month) =>
  new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const money = (n, currency) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;

// Income, spent and saved for the month. Savings count SGD only; INR is kept for investments.
function Summary({ month, spentSgd }) {
  const [income, setIncome] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEditing(false);
    setError('');
    api('/income?month=' + month).then((r) => { setIncome(r.data.amount); setDraft(r.data.amount ?? ''); }).catch((e) => setError(e.message));
  }, [month]);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/income', { method: 'PUT', body: { month, amount: draft } });
      setIncome(draft === '' ? null : Number(draft).toFixed(2));
      setEditing(false);
    } catch (err) {
      setError(err.message);
    }
  }

  const saved = income === null ? null : Number(income) - spentSgd;
  return (
    <section className="card summary">
      <div className="tile">
        <span className="tile-label">Income</span>
        {editing || income === null ? (
          <form onSubmit={save} className="income-form">
            <input type="number" step="0.01" min="0" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Enter income" />
            <span>SGD</span>
            <button type="submit" className="primary small">Save</button>
          </form>
        ) : (
          <span className="tile-value">
            {money(income, 'SGD')}
            <button className="link" onClick={() => setEditing(true)}>Edit</button>
          </span>
        )}
      </div>
      <div className="tile">
        <span className="tile-label">Spent</span>
        <span className="tile-value">{money(spentSgd, 'SGD')}</span>
      </div>
      <div className="tile">
        <span className="tile-label">Saved</span>
        <span className={'tile-value saved' + (saved !== null && saved < 0 ? ' negative' : '')}>
          {saved === null ? 'Enter income' : money(saved, 'SGD')}
        </span>
      </div>
      <p className="hint full">Savings count SGD only. INR entries are not included.</p>
      {error && <p className="error full">{error}</p>}
    </section>
  );
}

export default function SummaryPage() {
  const [month, setMonth] = useState(localMonth());
  const [spentSgd, setSpentSgd] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/expenses?month=' + month)
      .then((r) => setSpentSgd(r.data.expenses.filter((x) => x.currency === 'SGD').reduce((t, x) => t + Number(x.amount), 0)))
      .catch((e) => setError(e.message));
  }, [month]);

  return (
    <div className="expenses">
      <div className="month-bar">
        <button className="link" onClick={() => setMonth(shiftMonth(month, -1))}>‹ Previous</button>
        <h2>Summary for {monthLabel(month)}</h2>
        <button className="link" onClick={() => setMonth(shiftMonth(month, 1))}>Next ›</button>
      </div>
      <Summary month={month} spentSgd={spentSgd} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
