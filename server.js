
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Confirm the account still exists and use its current role.
    const user = db.prepare(
      'SELECT id, name, email, role FROM users WHERE id = ?'
    ).get(decoded.id);

    if (!user) {
      return res.status(401).json({
        error: 'Account no longer exists.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Invalid or expired token.'
    });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  next();
}

// saves a record of an important action (who did what)
function logAction(userId, action, entity, entityId) {
  db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id) VALUES (?, ?, ?, ?)')
    .run(userId, action, entity, entityId);
}

/* ---------- Transactions ---------- */

app.get('/api/transactions', authenticateToken, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC'
  ).all(req.user.id);
  res.json(rows);
});

app.post('/api/transactions', authenticateToken, (req, res) => {
  const t = req.body;

  if (!t.name || !t.category || !t.method || !t.date) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!(Number(t.amount) > 0)) {
    return res.status(400).json({ error: 'Amount must be greater than 0.' });
  }
  if (t.type !== 'income' && t.type !== 'expense') {
    return res.status(400).json({ error: 'Type must be income or expense.' });
  }

  const info = db.prepare(
    `INSERT INTO transactions
     (user_id, name, amount, type, category, method, date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(req.user.id, t.name, t.amount, t.type, t.category, t.method, t.date);

  logAction(req.user.id, 'Added ' + t.type + ' transaction', 'transaction', info.lastInsertRowid);
  res.status(201).json({ message: 'Saved' });
});

app.delete('/api/transactions/:id', authenticateToken, (req, res) => {
  const result = db.prepare(
    'DELETE FROM transactions WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Transaction not found.' });
  }

  logAction(req.user.id, 'Deleted a transaction', 'transaction', Number(req.params.id));
  res.sendStatus(204);
});

/* ---------- Bills ---------- */

app.get('/api/bills', authenticateToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM bills WHERE user_id = ? ORDER BY due').all(req.user.id);
  res.json(rows);
});

app.post('/api/bills', authenticateToken, (req, res) => {
  const b = req.body;

  if (!b.name || !b.due) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!(Number(b.amount) > 0)) {
    return res.status(400).json({ error: 'Amount must be greater than 0.' });
  }

  const info = db.prepare(
    'INSERT INTO bills (user_id, name, amount, due, frequency) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, b.name, b.amount, b.due, b.frequency || 'One-time');

  logAction(req.user.id, 'Added a bill', 'bill', info.lastInsertRowid);
  res.status(201).json({ message: 'Saved' });
});

app.patch('/api/bills/:id/pay', authenticateToken, (req, res) => {
  const bill = db.prepare(
    'SELECT * FROM bills WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!bill) {
    return res.status(404).json({ error: 'Bill not found.' });
  }
  if (bill.paid) {
    return res.status(409).json({ error: 'Bill is already paid.' });
  }

  const method = (req.body && req.body.method) || 'GCash';

  // all steps succeed together, or none of them happen
  const payNow = db.transaction(() => {
    db.prepare('UPDATE bills SET paid = 1 WHERE id = ? AND user_id = ?').run(bill.id, req.user.id);
    db.prepare(
      "INSERT INTO transactions (user_id, name, amount, type, category, method, date, bill_id) VALUES (?, ?, ?, 'expense', 'Bills', ?, date('now'), ?)"
    ).run(req.user.id, bill.name + ' Payment', bill.amount, method, bill.id);
    logAction(req.user.id, 'Marked ' + bill.name + ' as paid', 'bill', bill.id);
  });
  payNow();

  res.sendStatus(204);
});

/* ---------- Budget ---------- */

app.get('/api/budget', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT amount FROM budgets WHERE user_id = ?').get(req.user.id);
  res.json({ amount: row ? row.amount : 0 });
});

app.put('/api/budget', authenticateToken, (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!(amount >= 0)) {
    return res.status(400).json({ error: 'Budget must be 0 or higher.' });
  }

  db.prepare(
    'INSERT INTO budgets (user_id, amount) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET amount = excluded.amount'
  ).run(req.user.id, amount);

  logAction(req.user.id, 'Updated monthly budget', 'budget', req.user.id);
  res.sendStatus(204);
});

/* ---------- Savings goals ---------- */

app.get('/api/savings-goals', authenticateToken, (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, target_amount AS target, saved_amount AS saved, target_date AS date FROM savings_goals WHERE user_id = ? ORDER BY id DESC'
  ).all(req.user.id);
  res.json(rows);
});

app.post('/api/savings-goals', authenticateToken, (req, res) => {
  const { name, target, saved = 0, date = null } = req.body || {};
  const targetAmount = Number(target);
  const savedAmount = Number(saved);

  if (typeof name !== 'string' || !name.trim() || name.trim().length > 70) {
    return res.status(400).json({ error: 'Goal name must contain 1 to 70 characters.' });
  }
  if (!(targetAmount > 0) || !Number.isFinite(targetAmount)) {
    return res.status(400).json({ error: 'Target amount must be greater than 0.' });
  }
  if (!(savedAmount >= 0) || !Number.isFinite(savedAmount)) {
    return res.status(400).json({ error: 'Saved amount must be 0 or higher.' });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Target date must use YYYY-MM-DD format.' });
  }

  const info = db.prepare(
    'INSERT INTO savings_goals (user_id, name, target_amount, saved_amount, target_date) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), targetAmount, savedAmount, date || null);
  logAction(req.user.id, 'Created savings goal: ' + name.trim(), 'savings_goal', info.lastInsertRowid);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.post('/api/savings-goals/:id/contributions', authenticateToken, (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'Contribution must be greater than 0.' });
  }

  const goal = db.prepare(
    'SELECT id, name FROM savings_goals WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!goal) {
    return res.status(404).json({ error: 'Savings goal not found.' });
  }

  db.prepare('UPDATE savings_goals SET saved_amount = saved_amount + ? WHERE id = ? AND user_id = ?')
    .run(amount, goal.id, req.user.id);
  logAction(req.user.id, 'Added savings to ' + goal.name, 'savings_goal', goal.id);
  res.sendStatus(204);
});

app.delete('/api/savings-goals/:id', authenticateToken, (req, res) => {
  const result = db.prepare(
    'DELETE FROM savings_goals WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);
  if (!result.changes) {
    return res.status(404).json({ error: 'Savings goal not found.' });
  }

  logAction(req.user.id, 'Deleted a savings goal', 'savings_goal', Number(req.params.id));
  res.sendStatus(204);
});

/* ---------- Audit log ---------- */

app.get('/api/audit', authenticateToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json(rows);
});

   /* ---------- Accounts ---------- */

   app.post('/api/register', (req, res) => {
     const { name, email, password } = req.body || {};

     if (!name || !email || !password) {
       return res.status(400).json({ error: 'Missing required fields.' });
     }
     if (password.length < 8) {
       return res.status(400).json({ error: 'Password must be at least 8 characters.' });
     }

     const cleanEmail = email.trim().toLowerCase();
     const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
     if (exists) {
       return res.status(409).json({ error: 'Email is already registered.' });
     }

     const hash = bcrypt.hashSync(password, 10);
     const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
       .run(name.trim(), cleanEmail, hash);

     res.status(201).json({ id: info.lastInsertRowid, message: 'Account created' });
   });

   
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required.'
    });
  }

  const cleanEmail = email.trim().toLowerCase();

  const user = db.prepare(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ?'
  ).get(cleanEmail);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({
      error: 'Invalid email or password.'
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );

  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
});

app.get('/api/account/pin', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(req.user.id);
  res.json({ configured: Boolean(row && row.pin_hash) });
});

app.put('/api/account/pin', authenticateToken, (req, res) => {
  const { pin, currentPassword } = req.body || {};
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must contain exactly 4 digits.' });
  }

  const account = db.prepare('SELECT password_hash, pin_hash FROM users WHERE id = ?').get(req.user.id);
  if (account.pin_hash && (!currentPassword || !bcrypt.compareSync(currentPassword, account.password_hash))) {
    return res.status(401).json({ error: 'Account password is incorrect.' });
  }

  const pinHash = bcrypt.hashSync(pin, 10);
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(pinHash, req.user.id);
  logAction(req.user.id, account.pin_hash ? 'Changed account PIN' : 'Set account PIN', 'account', req.user.id);
  res.sendStatus(204);
});

app.post('/api/account/pin/verify', authenticateToken, (req, res) => {
  const pin = req.body && req.body.pin;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must contain exactly 4 digits.' });
  }

  const row = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row.pin_hash || !bcrypt.compareSync(pin, row.pin_hash)) {
    return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
  }
  res.sendStatus(204);
});

app.post('/api/account/password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.user.id);
  logAction(req.user.id, 'Changed account password', 'account', req.user.id);
  res.sendStatus(204);
});

/* ---------- CSV import (ETL) ---------- */

// splits one CSV line into cells (also handles "quoted, text")
function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

app.post('/api/import/transactions', authenticateToken, (req, res) => {
  const csv = req.body && req.body.csv;
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'No CSV data received.' });
  }

  // EXTRACT: split the text into lines and read the header row
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length < 2) {
    return res.status(400).json({ error: 'The file needs a header row and at least one data row.' });
  }
  if (lines.length > 1001) {
    return res.status(400).json({ error: 'Too many rows. The limit is 1000 rows per file.' });
  }

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const col = {
    name: header.includes('description') ? header.indexOf('description') : header.indexOf('name'),
    amount: header.indexOf('amount'),
    type: header.indexOf('type'),
    category: header.indexOf('category'),
    method: header.indexOf('method'),
    date: header.indexOf('date')
  };
  if (col.name < 0 || col.amount < 0 || col.type < 0 || col.date < 0) {
    return res.status(400).json({ error: 'The header row must have: description, amount, type, date (category and method are optional).' });
  }

  const findSame = db.prepare(
    'SELECT id FROM transactions WHERE user_id = ? AND name = ? AND amount = ? AND type = ? AND date = ? AND method = ?'
  );
  const clean = [];
  const rejected = [];
  const seen = new Set();
  let duplicates = 0;
  let total = 0;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    total++;
    const row = i + 1; // row number as it appears in the file (header is row 1)
    const c = parseCsvLine(lines[i]);

    // TRANSFORM: clean up each value
    const name = c[col.name] || '';
    const amount = Number(String(c[col.amount] || '').replace(/[₱,\s]/g, ''));
    const type = (c[col.type] || '').toLowerCase();
    const date = c[col.date] || '';
    const category = (col.category >= 0 && c[col.category]) || 'Others';
    const method = (col.method >= 0 && c[col.method]) || 'Imported';

    // VALIDATE: reject bad rows and say why
    if (!name) {
      rejected.push({ row, reason: 'Missing description.' });
      continue;
    }
    if (!(amount > 0)) {
      rejected.push({ row, reason: 'Amount must be a number greater than 0.' });
      continue;
    }
    if (type !== 'income' && type !== 'expense') {
      rejected.push({ row, reason: 'Type must be income or expense.' });
      continue;
    }
    const parsed = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed) || parsed.toISOString().slice(0, 10) !== date) {
      rejected.push({ row, reason: 'Date must be a real date written as YYYY-MM-DD.' });
      continue;
    }

    // skip rows that are already saved, or repeated inside the same file
    const key = [name, amount, type, date, method].join('|');
    if (seen.has(key) || findSame.get(req.user.id, name, amount, type, date, method)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    clean.push({ name, amount, type, category, method, date });
  }

  // LOAD: save all the clean rows together (all or nothing)
  const insert = db.prepare(
    'INSERT INTO transactions (user_id, name, amount, type, category, method, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const loadAll = db.transaction(() => {
    for (const r of clean) {
      insert.run(req.user.id, r.name, r.amount, r.type, r.category, r.method, r.date);
    }
  });
  loadAll();

  logAction(req.user.id, 'Imported ' + clean.length + ' transaction(s) from CSV', 'import', null);
  res.json({ total, loaded: clean.length, duplicates, rejected });
});

app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role, created_at FROM users ORDER BY id'
  ).all();
  res.json(users);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`MoneySync running at http://localhost:${port}`));