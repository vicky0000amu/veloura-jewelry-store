// ═══════════════════════════════════════════
//   Veloura JEWELS — Database Setup
//   Uses SQLite — no external database needed!
//   The database file (jewelry_store.db) is
//   created automatically on first run.
// ═══════════════════════════════════════════

const Database = require('better-sqlite3');
const path = require('path');

// This creates the database file in the backend folder
const db = new Database(path.join(__dirname, 'jewelry_store.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ─── CREATE TABLES (runs once on startup) ──────────────────
db.exec(`
  -- Admin accounts table
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Customer orders table
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    special_instructions TEXT DEFAULT '',
    items TEXT NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Newsletter subscribers table
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ Database ready — jewelry_store.db');

module.exports = db;
