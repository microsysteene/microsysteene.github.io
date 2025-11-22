const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('./database');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// helper: generate 5 char code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// helper: update room activity
function updateRoomActivity(roomCode) {
  const now = new Date().toISOString();
  db.run("UPDATE rooms SET lastActivity = ? WHERE code = ?", [now, roomCode]);
}

// websocket setup
// map to store client room: ws -> roomCode
const clientRooms = new Map();

wss.on('connection', (ws, req) => {
  // get room code from url: ws://url?room=CODE
  const parameters = url.parse(req.url, true);
  const roomCode = parameters.query.room;

  if (!roomCode) {
    ws.close();
    return;
  }

  ws.isAlive = true;
  ws.roomCode = roomCode;
  clientRooms.set(ws, roomCode);

  ws.on('pong', () => ws.isAlive = true);
  
  ws.on('close', () => {
    clientRooms.delete(ws);
  });
  
  ws.on('error', () => {
    clientRooms.delete(ws);
  });
});

// ping loop
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// notify clients in a specific room
function notifierClients(roomCode, type = 'update', payload = {}) {
  const message = JSON.stringify({ type, timestamp: Date.now(), ...payload });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === roomCode) {
      client.send(message);
    }
  });
}

// api room

// create a new room
app.post('/api/rooms', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'UserId required' });

  const code = generateRoomCode();
  const now = new Date().toISOString();

  db.run(`INSERT INTO rooms (code, adminId, announcementMessage, announcementColor, lastActivity, createdAt) 
          VALUES (?, ?, ?, ?, ?, ?)`,
    [code, userId, "", "#cdcdcd", now, now],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ code, adminId: userId });
    }
  );
});

// join/check room
app.get('/api/rooms/:code', (req, res) => {
  db.get("SELECT code, adminId, announcementMessage, announcementColor FROM rooms WHERE code = ?", 
    [req.params.code], 
    (err, room) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!room) return res.status(404).json({ error: "Room not found" });
      res.json(room);
    }
  );
});

// api annoncement

// get announcement
app.get('/api/announcement/:roomCode', (req, res) => {
  db.get("SELECT announcementMessage as texte, announcementColor as couleur FROM rooms WHERE code = ?", 
    [req.params.roomCode],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.json({ texte: "", couleur: "#cdcdcd" });
      res.json(row);
    }
  );
});

// update announcement (admin only)
app.put('/api/announcement/:roomCode', (req, res) => {
  const { texte, couleur, userId } = req.body;
  const roomCode = req.params.roomCode;

  // check admin rights
  db.get("SELECT adminId FROM rooms WHERE code = ?", [roomCode], (err, room) => {
    if (!room) return res.status(404).json({ error: "Room not found" });
    if (room.adminId !== userId) return res.status(403).json({ error: "Not authorized" });

    db.run("UPDATE rooms SET announcementMessage = ?, announcementColor = ?, lastActivity = ? WHERE code = ?",
      [texte, couleur || "#cdcdcd", new Date().toISOString(), roomCode],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        notifierClients(roomCode, 'updateAnnonce', { 
          message: { texte, couleur: couleur || "#cdcdcd" } 
        });
        
        res.json({ texte, couleur });
      }
    );
  });
});

// api

// get tickets for a room
app.get('/api/tickets/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  
  db.all("SELECT * FROM tickets WHERE roomCode = ? ORDER BY dateCreation DESC", [roomCode], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// create ticket
app.post('/api/tickets', (req, res) => {
  const { nom, description, couleur, etat, userId, roomCode } = req.body;
  if (!nom || !userId || !roomCode) return res.status(400).json({ error: 'Missing fields' });

  const id = Date.now().toString();
  const dateCreation = new Date().toISOString();

  // verify room exists first
  db.get("SELECT code FROM rooms WHERE code = ?", [roomCode], (err, room) => {
    if (!room) return res.status(404).json({ error: "Room not found" });

    db.run(`
      INSERT INTO tickets (id, nom, description, couleur, etat, dateCreation, userId, roomCode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [id, nom, description || '', couleur || '#cdcdcd', etat || 'en cours', dateCreation, userId, roomCode],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      updateRoomActivity(roomCode);
      notifierClients(roomCode);
      res.status(201).json({ id, nom, description, couleur, etat, dateCreation, userId, roomCode });
    });
  });
});

// update ticket
app.put('/api/tickets/:id', (req, res) => {
  const { nom, description, couleur, etat, roomCode } = req.body; // roomCode needed for notification
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
    
    if (roomCode) {
      updateRoomActivity(roomCode);
      notifierClients(roomCode);
    }
    res.json({ id, nom, description, couleur, etat });
  });
});

// delete ticket
app.delete('/api/tickets/:id', (req, res) => {
  const { userId, roomCode } = req.query; // roomCode needed for logic
  const id = req.params.id;

  db.get("SELECT t.*, r.adminId as roomAdminId FROM tickets t LEFT JOIN rooms r ON t.roomCode = r.code WHERE t.id = ?", [id], (err, ticket) => {
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    // check permissions: ticket owner OR room admin
    const isOwner = ticket.userId === userId;
    const isRoomAdmin = ticket.roomAdminId === userId;

    if (!isOwner && !isRoomAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    db.run("DELETE FROM tickets WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      updateRoomActivity(ticket.roomCode);
      notifierClients(ticket.roomCode);
      res.json({ message: "Ticket deleted" });
    });
  });
});


// cleanup: tickets expiration
function supprimerTicketsExpires() {
  const now = Date.now();
  const limitEnCours = 3 * 60 * 60 * 1000 + 10 * 60 * 1000; // 3h10
  const limitTermine = 60 * 60 * 1000; // 1h

  db.all("SELECT * FROM tickets", [], (err, rows) => {
    if (err) return;
    rows.forEach(ticket => {
      const age = now - new Date(ticket.dateCreation).getTime();
      if ((ticket.etat === "en cours" && age > limitEnCours) ||
          (ticket.etat === "terminé" && age > limitTermine)) {
        
        db.run("DELETE FROM tickets WHERE id = ?", ticket.id);
        // notify specific room
        notifierClients(ticket.roomCode);
      }
    });
  });
}

// cleanup: inactive empty rooms
function supprimerRoomsInactives() {
  const now = Date.now();
  const inactiveLimit = 30 * 60 * 1000; // 30 min

  db.all("SELECT * FROM rooms", [], (err, rooms) => {
    if (err) return;
    
    rooms.forEach(room => {
      const lastActivity = new Date(room.lastActivity || room.createdAt).getTime();
      const isInactive = (now - lastActivity) > inactiveLimit;

      if (isInactive) {
        // check for tickets
        db.get("SELECT count(*) as count FROM tickets WHERE roomCode = ?", [room.code], (err, row) => {
          if (row && row.count === 0) {
            // delete room if inactive and empty
            db.run("DELETE FROM rooms WHERE code = ?", room.code, () => {
              console.log(`Room ${room.code} deleted (inactive)`);
            });
          }
        });
      }
    });
  });
}

// run cleanup
setInterval(() => {
  supprimerTicketsExpires();
  supprimerRoomsInactives();
}, 60000);


app.get('/', (req, res) => res.json({ message: 'API Tickets Multi-Room OK' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API OK sur port ${PORT}`));