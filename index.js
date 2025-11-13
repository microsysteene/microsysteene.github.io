const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

const dataFile = path.join(__dirname, 'tickets.json');
let tickets = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile)) : [];

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
  res.json(tickets[index]);
});

// DELETE - Supprimer un ticket (si userId correspond)
app.delete('/api/tickets/:id', (req, res) => {
  const { userId } = req.body;
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
  if (ticket.userId !== userId) return res.status(403).json({ error: 'Non autorisé' });

  tickets = tickets.filter(t => t.id !== req.params.id);
  fs.writeFileSync(dataFile, JSON.stringify(tickets, null, 2));
  res.json({ message: 'Ticket supprimé', ticket });
});

app.get('/', (req, res) => {
  res.json({ message: 'API Tickets fonctionnelle' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur sur http://localhost:${PORT}`));
