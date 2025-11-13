const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Base de données en mémoire (remplacer par une vraie DB en production)
let tickets = [];

// GET - Récupérer tous les tickets
app.get('/api/tickets', (req, res) => {
  res.json(tickets);
});

// GET - Récupérer un ticket par ID
app.get('/api/tickets/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket non trouvé' });
  }
  res.json(ticket);
});

// POST - Créer un nouveau ticket
app.post('/api/tickets', (req, res) => {
  const { nom, description, couleur, etat } = req.body;
  
  if (!nom) {
    return res.status(400).json({ error: 'Le nom est obligatoire' });
  }

  const nouveauTicket = {
    id: Date.now().toString(),
    nom,
    description: description || '',
    couleur: couleur || '#cdcdcd',
    etat: etat || 'en cours',
    dateCreation: new Date().toISOString()
  };

  tickets.push(nouveauTicket);
  res.status(201).json(nouveauTicket);
});

// PUT - Mettre à jour un ticket
app.put('/api/tickets/:id', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Ticket non trouvé' });
  }

  const { nom, description, couleur, etat } = req.body;
  
  tickets[index] = {
    ...tickets[index],
    nom: nom || tickets[index].nom,
    description: description !== undefined ? description : tickets[index].description,
    couleur: couleur || tickets[index].couleur,
    etat: etat || tickets[index].etat
  };

  res.json(tickets[index]);
});

// DELETE - Supprimer un ticket
app.delete('/api/tickets/:id', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Ticket non trouvé' });
  }

  const ticketSupprime = tickets.splice(index, 1)[0];
  res.json({ message: 'Ticket supprimé', ticket: ticketSupprime });
});

// Route de test
app.get('/', (req, res) => {
  res.json({ 
    message: 'API Tickets fonctionnelle',
    endpoints: {
      'GET /api/tickets': 'Récupérer tous les tickets',
      'GET /api/tickets/:id': 'Récupérer un ticket',
      'POST /api/tickets': 'Créer un ticket',
      'PUT /api/tickets/:id': 'Mettre à jour un ticket',
      'DELETE /api/tickets/:id': 'Supprimer un ticket'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log(`🌐 API disponible sur http://localhost:${PORT}`);
});