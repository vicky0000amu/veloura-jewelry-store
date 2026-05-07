// ═══════════════════════════════════════════════════════════
//   Veloura JEWELS — Backend Server
//   Built with Express + SQLite (no database setup needed!)
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'lumiere-dev-secret-change-this';

// ─── MIDDLEWARE ───────────────────────────────────────────
app.use(cors({
  origin: '*', // In production, replace with your actual website URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ─── AUTH MIDDLEWARE ──────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required. Please login.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Session expired. Please login again.' });
  }
}

// ─── HELPER ───────────────────────────────────────────────
function generateOrderId() {
  const date = new Date();
  const year = date.getFullYear();
  const count = db.prepare('SELECT COUNT(*) as c FROM orders').get().c + 1;
  return `LUM-${year}-${String(count).padStart(4, '0')}`;
}

// ════════════════════════════════════════════════════════════
//   PUBLIC ROUTES (customers use these)
// ════════════════════════════════════════════════════════════

// ─── Health check ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '✨ Veloura Jewels API is live!',
    version: '1.0.0'
  });
});

// ─── Place a new order ────────────────────────────────────
// Called when customer clicks "Place Order" on the website
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, customer_email, delivery_address, special_instructions, items, total_amount } = req.body;

  // Validate required fields
  if (!customer_name || !customer_phone || !customer_email || !delivery_address) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }

  try {
    const order_id = generateOrderId();
    const items_json = JSON.stringify(items);

    db.prepare(`
      INSERT INTO orders (order_id, customer_name, customer_phone, customer_email, delivery_address, special_instructions, items, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(order_id, customer_name, customer_phone, customer_email, delivery_address, special_instructions || '', items_json, total_amount);

    // Try to send confirmation email (won't crash if email not configured)
    sendOrderConfirmation({ order_id, customer_name, customer_email, items, total_amount }).catch(() => {});

    res.status(201).json({
      success: true,
      order_id,
      message: `Order placed successfully! Your Order ID is ${order_id}. Save it to track your order.`
    });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// ─── Track an order (by Order ID) ────────────────────────
app.get('/api/orders/:orderId', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!order) {
    return res.status(404).json({ message: 'Order not found. Please check your Order ID.' });
  }
  const items = JSON.parse(order.items || '[]');
  res.json({
    order_id: order.order_id,
    customer_name: order.customer_name,
    status: order.status,
    items_count: items.length,
    total_amount: order.total_amount,
    created_at: order.created_at
  });
});

// ─── Newsletter subscribe ─────────────────────────────────
app.post('/api/newsletter', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required.' });
  try {
    db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
    res.json({ success: true, message: 'Subscribed successfully!' });
  } catch {
    res.status(500).json({ message: 'Could not subscribe. Try again.' });
  }
});

// ════════════════════════════════════════════════════════════
//   ADMIN ROUTES (only you can use these — protected by login)
// ════════════════════════════════════════════════════════════

// ─── First-time admin setup ───────────────────────────────
// Run this ONCE to create your admin account
app.post('/api/admin/setup', async (req, res) => {
  const existing = db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (existing) {
    return res.status(403).json({ message: 'Admin already exists. Use /api/admin/login instead.' });
  }
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ message: 'Username and password (min 8 chars) required.' });
  }
  const hashed = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run(username, hashed);
  res.json({ success: true, message: `Admin "${username}" created! You can now login at /admin.html` });
});

// ─── Admin login ──────────────────────────────────────────
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) return res.status(401).json({ message: 'Invalid username or password.' });

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(401).json({ message: 'Invalid username or password.' });

  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, username: admin.username });
});

// ─── Get all orders (admin) ───────────────────────────────
app.get('/api/admin/orders', requireAuth, (req, res) => {
  const { status, limit = 100 } = req.query;
  let query = 'SELECT * FROM orders';
  const params = [];
  if (status && status !== 'all') {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit));

  const orders = db.prepare(query).all(...params);
  res.json({ success: true, orders, count: orders.length });
});

// ─── Get single order detail (admin) ─────────────────────
app.get('/api/admin/orders/:orderId', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  order.items = JSON.parse(order.items || '[]');
  res.json(order);
});

// ─── Update order status (admin) ─────────────────────────
app.put('/api/admin/orders/:orderId/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status value.' });
  }
  const result = db.prepare('UPDATE orders SET status = ? WHERE order_id = ?').run(status, req.params.orderId);
  if (result.changes === 0) return res.status(404).json({ message: 'Order not found.' });
  res.json({ success: true, message: `Order status updated to "${status}"` });
});

// ─── Dashboard stats (admin) ──────────────────────────────
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const total_orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pending_orders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const delivered_orders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get().c;
  const total_revenue = db.prepare("SELECT SUM(total_amount) as r FROM orders WHERE status != 'cancelled'").get().r;

  res.json({ total_orders, pending_orders, delivered_orders, total_revenue: total_revenue || 0 });
});

// ─── Get subscribers (admin) ──────────────────────────────
app.get('/api/admin/subscribers', requireAuth, (req, res) => {
  const subscribers = db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC').all();
  res.json({ success: true, subscribers });
});

// ════════════════════════════════════════════════════════════
//   EMAIL (optional — works only if .env has email settings)
// ════════════════════════════════════════════════════════════
async function sendOrderConfirmation({ order_id, customer_name, customer_email, items, total_amount }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return; // Skip if not configured

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });

  const itemsList = items.map(i => `${i.name} × ${i.qty} — ₹${(i.price * i.qty).toLocaleString('en-IN')}`).join('\n');

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: customer_email,
    subject: `Order Confirmed — ${order_id} | Lumière Jewels`,
    text: `
Dear ${customer_name},

Your order has been placed successfully! 💎

Order ID: ${order_id}
(Save this to track your order on our website)

ITEMS ORDERED:
${itemsList}

Total: ₹${Number(total_amount).toLocaleString('en-IN')}
Payment: Cash on Delivery

We'll confirm your order within 24 hours and notify you when it's shipped.

With love,
Lumière Jewels Team
    `.trim()
  });
}

// ─── START SERVER ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('✨ ═══════════════════════════════════════════ ✨');
  console.log('   LUMIÈRE JEWELS BACKEND SERVER');
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log('   Admin setup: POST /api/admin/setup');
  console.log('✨ ═══════════════════════════════════════════ ✨');
  console.log('');
});
