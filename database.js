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

  // create rooms table
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    adminId TEXT,
    announcementMessage TEXT,
    announcementColor TEXT,
    lastActivity TEXT,
    createdAt TEXT
  )`);

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