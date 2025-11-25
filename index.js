const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('./database');
const url = require('url');
const multer = require('multer'); // new dependency
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// constants for limits
const MAX_ROOM_SIZE = 2 * 1024 * 1024 * 1024; // 2 gb
const UPLOAD_DIR = './uploads';

// ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR);
}

// configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // generate unique name
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'file-' + uniqueSuffix);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1 gb file limit
});

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
const clientRooms = new Map();

wss.on('connection', (ws, req) => {
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

// notify clients
function notifierClients(roomCode, type = 'update', payload = {}) {
  const message = JSON.stringify({ type, timestamp: Date.now(), ...payload });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === roomCode) {
      client.send(message);
    }
  });
}

// api room

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

// api announcement

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

app.put('/api/announcement/:roomCode', (req, res) => {
  const { texte, couleur, userId } = req.body;
  const roomCode = req.params.roomCode;

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

// api tickets

app.get('/api/tickets/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  
  db.all("SELECT * FROM tickets WHERE roomCode = ? ORDER BY dateCreation DESC", [roomCode], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/tickets', (req, res) => {
  const { nom, description, couleur, etat, userId, roomCode } = req.body;
  if (!nom || !userId || !roomCode) return res.status(400).json({ error: 'Missing fields' });

  const id = Date.now().toString();
  const dateCreation = new Date().toISOString();

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

app.put('/api/tickets/:id', (req, res) => {
  const { nom, description, couleur, etat, roomCode } = req.body;
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

app.delete('/api/tickets/:id', (req, res) => {
  const { userId } = req.query;
  const id = req.params.id;

  db.get("SELECT t.*, r.adminId as roomAdminId FROM tickets t LEFT JOIN rooms r ON t.roomCode = r.code WHERE t.id = ?", [id], (err, ticket) => {
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

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

// api files
// get files list and usage
app.get('/api/files/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;

  db.all("SELECT * FROM files WHERE roomCode = ?", [roomCode], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // calculate total size
    const usage = rows.reduce((acc, file) => acc + file.size, 0);
    
    res.json({
      files: rows,
      usage: usage,
      limit: MAX_ROOM_SIZE
    });
  });
});

// upload file with quota check
app.post('/api/files', upload.single('file'), (req, res) => {
  const { roomCode, userId } = req.body;
  const file = req.file;

  if (!file || !roomCode || !userId) {
    // cleanup if upload happened but data missing
    if (file) fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Missing file or data' });
  }

  // check total room usage
  db.get("SELECT SUM(size) as total FROM files WHERE roomCode = ?", [roomCode], (err, row) => {
    if (err) {
      fs.unlinkSync(file.path);
      return res.status(500).json({ error: err.message });
    }

    const currentUsage = row ? row.total || 0 : 0;
    
    // check quota
    if (currentUsage + file.size > MAX_ROOM_SIZE) {
      fs.unlinkSync(file.path);
      return res.status(413).json({ error: 'Room storage quota exceeded' });
    }

    // save to db
    const id = Date.now().toString(); // simple id generation
    
    db.run(`INSERT INTO files (id, originalName, encryptedName, mimeType, size, roomCode, userId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, file.originalname, file.filename, file.mimetype, file.size, roomCode, userId],
      (err) => {
        if (err) {
          fs.unlinkSync(file.path);
          return res.status(500).json({ error: err.message });
        }

        updateRoomActivity(roomCode);
        
        // notify room
        notifierClients(roomCode, 'newFile', { 
          file: { id, originalName: file.originalname, size: file.size, userId } 
        });

        res.status(201).json({ message: 'File uploaded' });
      }
    );
  });
});

// download file
app.get('/api/files/download/:fileId', (req, res) => {
  db.get("SELECT * FROM files WHERE id = ?", [req.params.fileId], (err, file) => {
    if (err || !file) return res.status(404).json({ error: 'File not found' });

    const filePath = path.join(UPLOAD_DIR, file.encryptedName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File missing on disk' });
    }

    res.download(filePath, file.originalName);
  });
});

// delete file
app.delete('/api/files/:fileId', (req, res) => {
  const { userId } = req.query;
  const fileId = req.params.fileId;

  db.get("SELECT f.*, r.adminId as roomAdminId FROM files f LEFT JOIN rooms r ON f.roomCode = r.code WHERE f.id = ?", 
    [fileId], 
    (err, file) => {
      if (!file) return res.status(404).json({ error: "File not found" });

      const isOwner = file.userId === userId;
      const isRoomAdmin = file.roomAdminId === userId;

      if (!isOwner && !isRoomAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      // delete from disk
      const filePath = path.join(UPLOAD_DIR, file.encryptedName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // delete from db
      db.run("DELETE FROM files WHERE id = ?", [fileId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        updateRoomActivity(file.roomCode);
        
        // notify room to refresh list
        notifierClients(file.roomCode, 'deleteFile', { fileId });
        
        res.json({ message: "File deleted" });
      });
  });
});

// cleanup logic

function supprimerTicketsExpires() {
  const now = Date.now();
  const limitEnCours = 3 * 60 * 60 * 1000 + 10 * 60 * 1000;
  const limitTermine = 60 * 60 * 1000;

  db.all("SELECT * FROM tickets", [], (err, rows) => {
    if (err) return;
    rows.forEach(ticket => {
      const age = now - new Date(ticket.dateCreation).getTime();
      if ((ticket.etat === "en cours" && age > limitEnCours) ||
          (ticket.etat === "terminé" && age > limitTermine)) {
        
        db.run("DELETE FROM tickets WHERE id = ?", ticket.id);
        notifierClients(ticket.roomCode);
      }
    });
  });
}

function supprimerRoomsInactives() {
  const now = Date.now();
  const inactiveLimit = 30 * 60 * 1000;

  db.all("SELECT * FROM rooms", [], (err, rooms) => {
    if (err) return;
    
    rooms.forEach(room => {
      const lastActivity = new Date(room.lastActivity || room.createdAt).getTime();
      const isInactive = (now - lastActivity) > inactiveLimit;

      if (isInactive) {
        // check tickets count
        db.get("SELECT count(*) as count FROM tickets WHERE roomCode = ?", [room.code], (err, row) => {
          if (row && row.count === 0) {
            
            // cleanup files first
            db.all("SELECT * FROM files WHERE roomCode = ?", [room.code], (err, files) => {
              if (files) {
                files.forEach(f => {
                  const p = path.join(UPLOAD_DIR, f.encryptedName);
                  if (fs.existsSync(p)) fs.unlinkSync(p);
                });
                // delete db file entries
                db.run("DELETE FROM files WHERE roomCode = ?", [room.code]);
              }

              // delete room
              db.run("DELETE FROM rooms WHERE code = ?", room.code, () => {
                console.log(`Room ${room.code} deleted (inactive)`);
              });
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