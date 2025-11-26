const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tickets.db');

db.serialize(() => {
  // create tickets table with room link
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    nom TEXT,
    description TEXT,
    couleur TEXT,
    etat TEXT,
    dateCreation TEXT,
    userId TEXT,
    roomCode TEXT
  )`);

  // create rooms table with maxTickets
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    adminId TEXT,
    announcementMessage TEXT,
    announcementColor TEXT,
    lastActivity TEXT,
    createdAt TEXT,
    maxTickets INTEGER DEFAULT 1
  )`, (err) => {
    // simple migration: if table exists but maxTickets missing, add it
    if (!err) {
      db.run("ALTER TABLE rooms ADD COLUMN maxTickets INTEGER DEFAULT 1", (e) => {
        // ignore error if column already exists
      });
    }
  });

  // create files table
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    originalName TEXT,
    encryptedName TEXT,
    mimeType TEXT,
    size INTEGER,
    roomCode TEXT,
    userId TEXT
  )`);
});

module.exports = db;