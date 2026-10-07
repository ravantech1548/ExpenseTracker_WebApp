import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';

const {
  DATABASE_URL,
  ADMIN_USERNAME = 'admin',
  ADMIN_PASSWORD,
  GOOGLE_CLIENT_ID = '',
  COOKIE_SECURE = 'true',
  PORT = 3000,
} = process.env;

const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 10;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const google = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const app = express();
app.use(express.json({ limit: '100kb' }));

const q = (text, params) => pool.query(text, params);

// ---------- sessions ----------

function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [token, userId]);
  const secure = COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

async function currentUser(req) {
  const token = readCookie(req, 'sid');
  if (!token) return null;
  const { rows } = await q(
    `SELECT u.id, u.username, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() AND u.status = 'active'`,
    [token],
  );
  return rows[0] || null;
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const requireUser = wrap(async (req, res, next) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in' });
  req.user = user;
  next();
});

const requireAdmin = wrap(async (req, res, next) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  req.user = user;
  next();
});

// ---------- auth ----------

app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));

app.get('/api/me', wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json(user);
}));

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const fail = () => res.status(401).json({ error: 'Wrong username or password' });
  if (typeof username !== 'string' || typeof password !== 'string') return fail();

  const { rows } = await q('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !user.password_hash) return fail();
  if (user.locked_until && user.locked_until > new Date()) {
    return res.status(423).json({ error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` });
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    const lock = user.failed_attempts + 1 >= MAX_FAILED;
    await q(
      `UPDATE users SET failed_attempts = $2,
         locked_until = CASE WHEN $3 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE NULL END
       WHERE id = $1`,
      [user.id, lock ? 0 : user.failed_attempts + 1, lock],
    );
    return fail();
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'This account is not active' });

  await q('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
  await startSession(res, user.id);
  res.json({ ok: true });
}));

// Sign in with Google. An unknown Gmail address becomes an application the admin approves.
app.post('/api/login/google', wrap(async (req, res) => {
  if (!google) return res.status(400).json({ error: 'Google sign-in is not set up yet' });
  let payload;
  try {
    const ticket = await google.verifyIdToken({ idToken: req.body?.credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Google sign-in failed' });
  }
  if (!payload.email_verified) return res.status(401).json({ error: 'Google email is not verified' });

  const email = payload.email.toLowerCase();
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) {
    await q('INSERT INTO users (email, name) VALUES ($1, $2)', [email, payload.name || email]);
    return res.status(202).json({ status: 'pending', message: 'Thanks for applying. The admin will review your request.' });
  }
  if (user.status === 'pending') return res.status(202).json({ status: 'pending', message: 'Your application is waiting for admin approval.' });
  if (user.status === 'rejected') return res.status(403).json({ error: 'Your application was not approved.' });

  await startSession(res, user.id);
  res.json({ ok: true });
}));

app.post('/api/logout', wrap(async (req, res) => {
  const token = readCookie(req, 'sid');
  if (token) await q('DELETE FROM sessions WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

// ---------- configuration (admin only) ----------

// Each configuration list: table, key column, editable fields.
const LISTS = {
  'family-members': { table: 'family_members', key: 'id', fields: ['name'] },
  categories: { table: 'categories', key: 'id', fields: ['name', 'colour'] },
  providers: { table: 'providers', key: 'id', fields: ['name', 'category_id'] },
  'payment-modes': { table: 'payment_modes', key: 'id', fields: ['name'] },
  currencies: { table: 'currencies', key: 'code', fields: ['code', 'name'] },
};

function pickFields(list, body) {
  const values = list.fields.map((f) => {
    const v = body?.[f];
    return v === '' || v === undefined ? null : v;
  });
  if (values[0] === null) throw Object.assign(new Error(`${list.fields[0]} is required`), { status: 400 });
  return values;
}

app.get('/api/config/:list', requireAdmin, wrap(async (req, res) => {
  const list = LISTS[req.params.list];
  if (!list) return res.sendStatus(404);
  const { rows } = await q(`SELECT * FROM ${list.table} ORDER BY ${list.fields[0]}`);
  res.json(rows);
}));

app.post('/api/config/:list', requireAdmin, wrap(async (req, res) => {
  const list = LISTS[req.params.list];
  if (!list) return res.sendStatus(404);
  const values = pickFields(list, req.body);
  const cols = list.fields.join(', ');
  const params = list.fields.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await q(`INSERT INTO ${list.table} (${cols}) VALUES (${params}) RETURNING *`, values);
  res.status(201).json(rows[0]);
}));

app.put('/api/config/:list/:key', requireAdmin, wrap(async (req, res) => {
  const list = LISTS[req.params.list];
  if (!list) return res.sendStatus(404);
  const values = pickFields(list, req.body);
  const sets = list.fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const { rows } = await q(
    `UPDATE ${list.table} SET ${sets} WHERE ${list.key} = $${values.length + 1} RETURNING *`,
    [...values, req.params.key],
  );
  if (!rows[0]) return res.sendStatus(404);
  res.json(rows[0]);
}));

app.delete('/api/config/:list/:key', requireAdmin, wrap(async (req, res) => {
  const list = LISTS[req.params.list];
  if (!list) return res.sendStatus(404);
  await q(`DELETE FROM ${list.table} WHERE ${list.key} = $1`, [req.params.key]);
  res.json({ ok: true });
}));

// Users: approve or reject Gmail applications.
app.get('/api/users', requireAdmin, wrap(async (req, res) => {
  const { rows } = await q('SELECT id, username, email, name, role, status, created_at FROM users ORDER BY created_at');
  res.json(rows);
}));

app.post('/api/users', requireAdmin, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim() || email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  await q("INSERT INTO users (email, name, status) VALUES ($1, $2, 'active')", [email, name]);
  res.status(201).json({ ok: true });
}));

app.put('/api/users/:id/status', requireAdmin, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot change your own account' });
  await q('UPDATE users SET status = $2 WHERE id = $1', [req.params.id, status]);
  if (status !== 'active') await q('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- expenses (any approved user) ----------

// Lists needed by the expense form.
app.get('/api/lookups', requireUser, wrap(async (req, res) => {
  const [categories, providers, paymentModes, currencies, members] = await Promise.all([
    q('SELECT * FROM categories ORDER BY name'),
    q('SELECT * FROM providers ORDER BY name'),
    q('SELECT * FROM payment_modes ORDER BY name'),
    q('SELECT * FROM currencies ORDER BY code'),
    q('SELECT * FROM family_members ORDER BY name'),
  ]);
  res.json({
    categories: categories.rows,
    providers: providers.rows,
    paymentModes: paymentModes.rows,
    currencies: currencies.rows,
    members: members.rows,
  });
}));

const EXPENSE_FIELDS = ['spent_on', 'category_id', 'provider_id', 'amount', 'currency', 'payment_mode_id', 'member_id'];

function expenseValues(body) {
  const v = EXPENSE_FIELDS.map((f) => (body?.[f] === '' || body?.[f] === undefined ? null : body[f]));
  const [spentOn, categoryId, , amount, currency] = v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn || '')) throw Object.assign(new Error('Date is required'), { status: 400 });
  if (!categoryId) throw Object.assign(new Error('Category is required'), { status: 400 });
  if (!(Number(amount) > 0)) throw Object.assign(new Error('Amount must be more than 0'), { status: 400 });
  if (!currency) throw Object.assign(new Error('Currency is required'), { status: 400 });
  return v;
}

app.get('/api/expenses', requireUser, wrap(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const { rows } = await q(
    `SELECT e.*, to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on, u.name AS created_by_name
     FROM expenses e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.spent_on >= to_date($1, 'YYYY-MM') AND e.spent_on < to_date($1, 'YYYY-MM') + interval '1 month'
     ORDER BY e.spent_on DESC, e.id DESC`,
    [month],
  );
  res.json({ month, expenses: rows });
}));

app.post('/api/expenses', requireUser, wrap(async (req, res) => {
  const values = expenseValues(req.body);
  const { rows } = await q(
    `INSERT INTO expenses (${EXPENSE_FIELDS.join(', ')}, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [...values, req.user.id],
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/expenses/:id', requireUser, wrap(async (req, res) => {
  const values = expenseValues(req.body);
  const sets = EXPENSE_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const { rowCount } = await q(`UPDATE expenses SET ${sets} WHERE id = $8`, [...values, req.params.id]);
  if (!rowCount) return res.sendStatus(404);
  res.json({ ok: true });
}));

app.delete('/api/expenses/:id', requireUser, wrap(async (req, res) => {
  await q('DELETE FROM expenses WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// ---------- monthly income (any approved user) ----------

app.get('/api/income', requireUser, wrap(async (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.query.month || '')) throw bad('Month is required');
  const { rows } = await q("SELECT amount FROM incomes WHERE month = to_date($1, 'YYYY-MM')", [req.query.month]);
  res.json({ month: req.query.month, amount: rows[0]?.amount ?? null });
}));

app.put('/api/income', requireUser, wrap(async (req, res) => {
  const { month, amount } = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('Month is required');
  if (amount === null || amount === '' || amount === undefined) {
    await q("DELETE FROM incomes WHERE month = to_date($1, 'YYYY-MM')", [month]);
    return res.json({ ok: true });
  }
  if (!(Number(amount) >= 0)) throw bad('Income must be 0 or more');
  await q(
    `INSERT INTO incomes (month, amount) VALUES (to_date($1, 'YYYY-MM'), $2)
     ON CONFLICT (month) DO UPDATE SET amount = EXCLUDED.amount`,
    [month, amount],
  );
  res.json({ ok: true });
}));

// ---------- recurring bills (any approved user) ----------

const BILL_FIELDS = ['name', 'category_id', 'provider_id', 'member_id', 'currency', 'usual_amount', 'due_day', 'payment_mode_id', 'active'];

function billValues(body) {
  const v = BILL_FIELDS.map((f) => (body?.[f] === '' || body?.[f] === undefined ? null : body[f]));
  const [name, categoryId, , , currency, usualAmount, dueDay] = v;
  if (!String(name || '').trim()) throw bad('Name is required');
  if (!categoryId) throw bad('Category is required');
  if (!currency) throw bad('Currency is required');
  if (usualAmount !== null && !(Number(usualAmount) > 0)) throw bad('Usual amount must be more than 0');
  if (!(Number(dueDay) >= 1 && Number(dueDay) <= 31)) throw bad('Due day must be between 1 and 31');
  v[8] = v[8] !== false; // active defaults to true
  return v;
}

app.get('/api/bills', requireUser, wrap(async (req, res) => {
  const { rows } = await q('SELECT * FROM bills ORDER BY due_day, name');
  res.json(rows);
}));

app.post('/api/bills', requireUser, wrap(async (req, res) => {
  const values = billValues(req.body);
  const params = BILL_FIELDS.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await q(`INSERT INTO bills (${BILL_FIELDS.join(', ')}) VALUES (${params}) RETURNING id`, values);
  res.status(201).json(rows[0]);
}));

app.put('/api/bills/:id', requireUser, wrap(async (req, res) => {
  const values = billValues(req.body);
  const sets = BILL_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const { rowCount } = await q(`UPDATE bills SET ${sets} WHERE id = $${values.length + 1}`, [...values, req.params.id]);
  if (!rowCount) return res.sendStatus(404);
  res.json({ ok: true });
}));

// Deleting a bill keeps its past payments as ordinary expenses.
app.delete('/api/bills/:id', requireUser, wrap(async (req, res) => {
  await q('DELETE FROM bills WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// The month's checklist: each active bill with its due date, payment (if paid) and a suggested amount.
app.get('/api/bills/checklist', requireUser, wrap(async (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.query.month || '')) throw bad('Month is required');
  const { rows } = await q(
    `SELECT b.*,
       to_char(to_date($1, 'YYYY-MM') + (LEAST(b.due_day,
         EXTRACT(DAY FROM to_date($1, 'YYYY-MM') + interval '1 month' - interval '1 day')::int) - 1), 'YYYY-MM-DD') AS due_on,
       e.id AS expense_id, e.amount AS paid_amount, e.currency AS paid_currency,
       e.payment_mode_id AS paid_payment_mode_id, to_char(e.spent_on, 'YYYY-MM-DD') AS paid_on,
       COALESCE((SELECT l.amount FROM expenses l WHERE l.bill_id = b.id ORDER BY l.bill_month DESC LIMIT 1), b.usual_amount) AS suggested_amount
     FROM bills b
     LEFT JOIN expenses e ON e.bill_id = b.id AND e.bill_month = to_date($1, 'YYYY-MM')
     WHERE b.active OR e.id IS NOT NULL
     ORDER BY b.due_day, b.name`,
    [req.query.month],
  );
  res.json(rows);
}));

// Mark a bill paid for a month: records it as an expense.
app.post('/api/bills/:id/pay', requireUser, wrap(async (req, res) => {
  const { month, amount, payment_mode_id: paymentModeId, paid_on: paidOn } = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('Month is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn || '')) throw bad('Paid date is required');
  if (!(Number(amount) > 0)) throw bad('Amount must be more than 0');
  if (!paymentModeId) throw bad('Choose a payment mode');
  const { rows } = await q('SELECT * FROM bills WHERE id = $1', [req.params.id]);
  const bill = rows[0];
  if (!bill) return res.sendStatus(404);
  try {
    await q(
      `INSERT INTO expenses (spent_on, category_id, provider_id, amount, currency, payment_mode_id, member_id, created_by, bill_id, bill_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_date($10, 'YYYY-MM'))`,
      [paidOn, bill.category_id, bill.provider_id, amount, bill.currency, paymentModeId, bill.member_id, req.user.id, bill.id, month],
    );
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This bill is already paid for that month' });
    throw err;
  }
  res.status(201).json({ ok: true });
}));

// ---------- errors and startup ----------

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'That already exists' });
  if (err.code === '23503') {
    const missing = /is not present/.test(err.detail || '');
    return res.status(409).json({ error: missing ? 'One of the choices no longer exists. Please reload.' : 'It is still in use' });
  }
  if (err.code === '22P02' || err.code === '22003') return res.status(400).json({ error: 'Please check the values entered' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Tables added after slice 1. db/init.sql only runs on a brand-new database.
async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS expenses (
      id              SERIAL PRIMARY KEY,
      spent_on        DATE NOT NULL,
      category_id     INT NOT NULL REFERENCES categories(id),
      provider_id     INT REFERENCES providers(id),
      amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      currency        TEXT NOT NULL REFERENCES currencies(code) ON UPDATE CASCADE,
      payment_mode_id INT REFERENCES payment_modes(id),
      member_id       INT REFERENCES family_members(id),  -- NULL means a common Family expense
      created_by      INT REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Slice 3: monthly recurring bills. Paying a bill creates an expense linked to that bill and month.
  await q(`
    CREATE TABLE IF NOT EXISTS bills (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      category_id     INT NOT NULL REFERENCES categories(id),
      provider_id     INT REFERENCES providers(id),
      member_id       INT REFERENCES family_members(id),  -- NULL means a common Family bill
      currency        TEXT NOT NULL REFERENCES currencies(code) ON UPDATE CASCADE,
      usual_amount    NUMERIC(12, 2) CHECK (usual_amount > 0),
      due_day         INT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      payment_mode_id INT REFERENCES payment_modes(id),
      active          BOOLEAN NOT NULL DEFAULT true
    )`);
  await q('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bill_id INT REFERENCES bills(id) ON DELETE SET NULL');
  await q('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bill_month DATE');
  await q('CREATE UNIQUE INDEX IF NOT EXISTS expenses_bill_month ON expenses (bill_id, bill_month)');
  // Slice 4: one household income per month, in SGD.
  await q(`
    CREATE TABLE IF NOT EXISTS incomes (
      month  DATE PRIMARY KEY,  -- first day of the month
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0)
    )`);
}

async function ensureAdmin() {
  const { rows } = await q("SELECT 1 FROM users WHERE role = 'admin'");
  if (rows.length) return;
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < MIN_PASSWORD) {
    throw new Error(`Set ADMIN_PASSWORD (at least ${MIN_PASSWORD} characters) to create the admin account`);
  }
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await q("INSERT INTO users (username, name, password_hash, role, status) VALUES ($1, 'Admin', $2, 'admin', 'active')", [ADMIN_USERNAME, hash]);
  console.log(`Created admin account "${ADMIN_USERNAME}"`);
}

async function start() {
  for (let i = 0; ; i++) {
    try {
      await migrate();
      await ensureAdmin();
      break;
    } catch (err) {
      if (err.message.startsWith('Set ADMIN_PASSWORD') || i >= 30) throw err;
      await new Promise((r) => setTimeout(r, 2000)); // database still starting
    }
  }
  app.listen(PORT, () => console.log(`API listening on ${PORT}`));
}

start().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
