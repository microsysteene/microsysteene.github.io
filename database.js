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

  db.run(`CREATE TABLE IF NOT EXISTS announcement (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    message TEXT,
    dateCreation TEXT
  )`);

  db.get("SELECT * FROM announcement WHERE id = 1", (err, row) => {
    if (!row) {
      db.run("INSERT INTO announcement (id, message, dateCreation) VALUES (1, '', ?)", new Date().toISOString());
    }
  });
});

module.exports = db;
