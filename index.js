const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const dataFile = path.join(__dirname, 'tickets.json');
let tickets = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile)) : [];

// ===== WebSocket =====
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('Nouveau client WebSocket connecté');
  clients.add(ws);

  ws.on('close', () => {
    console.log('Client WebSocket déconnecté');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('Erreur WebSocket:', error);
    clients.delete(ws);
  });
});

// Fonction pour notifier tous les clients
function notifierClients() {
  const message = JSON.stringify({ type: 'update', timestamp: Date.now() });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ===== Routes API =====

// GET - Tous les tickets
app.get('/api/tickets', (req, res) => {
  res.json(tickets);
});

// POST - Créer un ticket
app.post('/api/tickets', (req, res) => {
  const { nom, description, couleur, etat, userId } = req.body;
  if (!nom || !userId) return res.status(400).json({ error: 'Nom et userId requis' });

  const nouveauTicket = {
    id: Date.now().toString(),
    nom,
    description: description || '',
    couleur: couleur || '#cdcdcd',
    etat: etat || 'en cours',
    dateCreation: new Date().toISOString(),
    userId
  };

  tickets.push(nouveauTicket);
  fs.writeFileSync(dataFile, JSON.stringify(tickets, null, 2));
  
  // Notifier tous les clients
  notifierClients();
  
  res.status(201).json(nouveauTicket);
});

// PUT - Modifier un ticket
app.put('/api/tickets/:id', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Ticket non trouvé' });

  const { nom, description, couleur, etat } = req.body;
  tickets[index] = {
    ...tickets[index],
    nom: nom || tickets[index].nom,
    description: description ?? tickets[index].description,
    couleur: couleur || tickets[index].couleur,
    etat: etat || tickets[index].etat
  };

  fs.writeFileSync(dataFile, JSON.stringify(tickets, null, 2));
  
  // Notifier tous les clients
  notifierClients();
  
  res.json(tickets[index]);
});

// DELETE - Supprimer un ticket
app.delete('/api/tickets/:id', (req, res) => {
  const { userId, isAdmin } = req.body;
  const ticket = tickets.find(t => t.id === req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
  if (ticket.userId !== userId && !isAdmin)
    return res.status(403).json({ error: 'Non autorisé' });

  tickets = tickets.filter(t => t.id !== req.params.id);
  fs.writeFileSync(dataFile, JSON.stringify(tickets, null, 2));
  
  // Notifier tous les clients
  notifierClients();
  
  res.json({ message: 'Ticket supprimé', ticket });
});

// ===== Suppression automatique =====
function supprimerTicketsExpires() {
  const maintenant = Date.now();
  const ticketsAvant = tickets.length;

  const troisHeuresDix = 3 * 60 * 60 * 1000 + 10 * 60 * 1000; // 3h10
  const uneHeure = 60 * 60 * 1000; // 1h

  tickets = tickets.filter(ticket => {
    const age = maintenant - new Date(ticket.dateCreation).getTime();
    
    if (ticket.etat === 'en cours' && age > troisHeuresDix) {
      return false;
    }
    if (ticket.etat === 'terminé' && age > uneHeure) {
      return false;
    }
    return true;
  });

  if (tickets.length !== ticketsAvant) {
    fs.writeFileSync(dataFile, JSON.stringify(tickets, null, 2));
    // Notifier tous les clients qu'il y a eu des suppressions
    notifierClients();
    console.log(`${ticketsAvant - tickets.length} ticket(s) expiré(s) supprimé(s)`);
  }
}

setInterval(supprimerTicketsExpires, 60 * 1000); // Toutes les 60 secondes

app.get('/', (req, res) => {
  res.json({ message: 'API Tickets fonctionnelle' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur sur le port ${PORT}`));