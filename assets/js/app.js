const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// websocket
const clients = new Set();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  clients.add(ws);

  ws.on('pong', () => ws.isAlive = true);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ping loop
setInterval(() => {
  clients.forEach(ws => {
    if (!ws.isAlive) {
      ws.terminate();
      clients.delete(ws);
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function notifierClients() {
  const message = JSON.stringify({ type: 'update', timestamp: Date.now() });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN)
      client.send(message);
  });
}

// message admin
let adminMessage = "";
let adminMessageTimeout = null;

function notifierAnnonce() {
  const message = JSON.stringify({ type: 'updateAnnonce', message: adminMessage });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN)
      client.send(message);
  });
}

function clearAdminMessage() {
  adminMessage = "";
  adminMessageTimeout = null;
  notifierAnnonce();
}

// GET message admin
app.get('/api/announcement', (req, res) => {
  res.json({ message: adminMessage });
});

// PUT message admin
app.put('/api/announcement', (req, res) => {
  const { message } = req.body;
  if (typeof message !== 'string') return res.status(400).json({ error: "message invalide" });

  adminMessage = message;
  notifierAnnonce();

  // reset timer de suppression après 3 heures
  if (adminMessageTimeout) clearTimeout(adminMessageTimeout);
  adminMessageTimeout = setTimeout(clearAdminMessage, 3 * 60 * 60 * 1000);

  res.json({ message: adminMessage });
});

// api ticket

// GET tickets
app.get('/api/tickets', (req, res) => {
  db.all("SELECT * FROM tickets ORDER BY dateCreation DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST tickets
app.post('/api/tickets', (req, res) => {
  const { nom, description, couleur, etat, userId } = req.body;
  if (!nom || !userId) return res.status(400).json({ error: 'Nom et userId requis' });

  const id = Date.now().toString();
  const dateCreation = new Date().toISOString();

  db.run(`
    INSERT INTO tickets (id, nom, description, couleur, etat, dateCreation, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  [id, nom, description || '', couleur || '#cdcdcd', etat || 'en cours', dateCreation, userId],
  (err) => {
    if (err) return res.status(500).json({ error: err.message });
    notifierClients();
    res.status(201).json({ id, nom, description, couleur, etat, dateCreation, userId });
  });
});

// PUT tickets
app.put('/api/tickets/:id', (req, res) => {
  const { nom, description, couleur, etat } = req.body;
  const id = req.params.id;

  db.run(`
    UPDATE tickets SET
      nom = COALESCE(?, nom),
      description = COALESCE(?, description),
      couleur = COALESCE(?, couleur),
      etat = COALESCE(?, etat)
    WHERE id = ?
  `,
  [nom, description, couleur, etat, id],
  (err) => {
    if (err) return res.status(500).json({ error: err.message });
    notifierClients();
    res.json({ id, nom, description, couleur, etat });
  });
});

// DELETE tickets
app.delete('/api/tickets/:id', (req, res) => {
  const userId = req.query.userId;
  const isAdmin = req.query.admin === 'true';
  const id = req.params.id;

  db.get("SELECT * FROM tickets WHERE id = ?", [id], (err, ticket) => {
    if (!ticket) return res.status(404).json({ error: "Ticket non trouvé" });
    if (ticket.userId !== userId && !isAdmin)
      return res.status(403).json({ error: "Non autorisé" });

    db.run("DELETE FROM tickets WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      notifierClients();
      res.json({ message: "Ticket supprimé", ticket });
    });
  });
});

// expiration automatique des tickets
function supprimerTicketsExpires() {
  const maintenant = Date.now();
  const troisHeuresDix = 3 * 60 * 60 * 1000 + 10 * 60 * 1000;
  const uneHeure = 60 * 60 * 1000;

  db.all("SELECT * FROM tickets", [], (err, rows) => {
    if (err) return;
    rows.forEach(ticket => {
      const age = maintenant - new Date(ticket.dateCreation).getTime();
      if ((ticket.etat === "en cours" && age > troisHeuresDix) ||
          (ticket.etat === "terminé" && age > uneHeure)) {
        db.run("DELETE FROM tickets WHERE id = ?", ticket.id);
      }
    });
    notifierClients();
  });
}

setInterval(supprimerTicketsExpires, 60000);

app.get('/', (req, res) => res.json({ message: 'API Tickets OK' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API OK sur port ${PORT}`));
