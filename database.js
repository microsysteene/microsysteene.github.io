const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tickets.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    nom TEXT,
    description TEXT,
    couleur TEXT,
    etat TEXT,
    dateCreation TEXT,
    userId TEXT
  )`);
});

module.exports = db;
