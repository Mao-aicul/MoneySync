
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

// saves a record of an important action (who did what)
function logAction(userId, action, entity, entityId) {
  db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id) VALUES (?, ?, ?, ?)')
    .run(userId, action, entity, entityId);
}

/* ---------- Transactions ---------- */

app.get('/api/transactions', authenticateToken, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ?'
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

app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role, created_at FROM users ORDER BY id'
  ).all();

  res.json(users);
});


app.listen(3000, () => console.log('MoneySync running at http://localhost:3000'));