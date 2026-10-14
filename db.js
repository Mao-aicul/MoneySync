const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'moneysync.db'));
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('pin_hash')) {
	db.exec('ALTER TABLE users ADD COLUMN pin_hash TEXT');
}

module.exports = db;
