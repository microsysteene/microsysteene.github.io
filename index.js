const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('./database');
const url = require('url');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // load env

// import ai filter
const { checkTicketSafety, getAiStatus } = require('./ai_filter');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // parse form data

// serve public assets (css, js, images) normally
app.use(express.static('public')); 

// global settings
let globalSettings = {
    maxRooms: 50,
    maxRoomSize: 1.25 * 1024 * 1024 * 1024
};

const UPLOAD_DIR = './uploads';

// ensure dir
if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'file-' + uniqueSuffix);
  }
});

const upload = multer({ storage: storage });

// generate room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// update activity
function updateRoomActivity(roomCode) {
  const now = new Date().toISOString();
  db.run("UPDATE rooms SET lastActivity = ? WHERE code = ?", [now, roomCode]);
}

// helper: validate content with ai
async function validateContent(text) {
    // check global dynamic status
    if (!getAiStatus()) return true; // AI is off or broken -> allow content
    
    console.log(`analysing: ${text.substring(0, 20)}...`);
    const analysis = await checkTicketSafety(text);
    
    // if analysis was skipped due to error during process
    if (analysis.skipped) return true;

    // return false if unsafe
    if (analysis.is_unsafe) return false;
    return true;
}

const clientRooms = new Map();

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true);
  const roomCode = parameters.query.room;
  const type = parameters.query.type;

  // admin
  if (!roomCode && type === 'admin') {
      ws.isAdmin = true;
      return;
  }

  // client
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

// ping loop to keep connections alive
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});


app.post('/access', (req, res) => {
    const password = req.body.password;
    
    if (password === process.env.ADMIN_PASSWORD) {
        const dashboardPath = path.join(__dirname, 'private', 'index.html');
        fs.readFile(dashboardPath, 'utf8', (err, data) => {
            if (err) return res.status(500).send('Error loading dashboard');
            res.send(data);
        });
    } else {
        res.redirect('/');
    }
});

app.get('/api/admin/dashboard', (req, res) => {
    db.all("SELECT code, createdAt, lastActivity FROM rooms", [], (err, rooms) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all("SELECT roomCode, SUM(size) as totalSize FROM files GROUP BY roomCode", [], (err, filesRows) => {
            if (err) return res.status(500).json({ error: err.message });

            const sizeMap = {};
            filesRows.forEach(row => sizeMap[row.roomCode] = row.totalSize);
            const onlineMap = {};
            let totalOnline = 0;
            wss.clients.forEach(client => {
                if (client.roomCode) {
                    onlineMap[client.roomCode] = (onlineMap[client.roomCode] || 0) + 1;
                    totalOnline++;
                }
            });

            const enrichedRooms = rooms.map(room => ({
                code: room.code,
                createdAt: room.createdAt,
                storageUsed: sizeMap[room.code] || 0,
                usersOnline: onlineMap[room.code] || 0
            }));

            res.json({
                settings: globalSettings,
                stats: {
                    totalPeople: totalOnline,
                    totalGroups: rooms.length
                },
                rooms: enrichedRooms
            });
        });
    });
});

app.put('/api/admin/settings', (req, res) => {
    const { maxRooms, maxStorageGB } = req.body;
    
    if (maxRooms) globalSettings.maxRooms = parseInt(maxRooms);
    if (maxStorageGB) globalSettings.maxRoomSize = parseFloat(maxStorageGB) * 1024 * 1024 * 1024;

    res.json(globalSettings);
});

app.post('/api/rooms', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'UserId required' });

  db.get("SELECT count(*) as count FROM rooms", [], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (result && result.count >= globalSettings.maxRooms) {
          return res.status(403).json({ error: 'Server full (max rooms reached)' });
      }

      const code = generateRoomCode();
      const now = new Date().toISOString();

      db.run(`INSERT INTO rooms (code, adminId, announcementMessage, announcementColor, lastActivity, createdAt, maxTickets) 
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [code, userId, "", "#cdcdcd", now, now, 1],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.status(201).json({ code, adminId: userId });
        }
      );
  });
});

app.get('/api/rooms/:code', (req, res) => {
  db.get("SELECT code, adminId, announcementMessage, announcementColor, maxTickets FROM rooms WHERE code = ?", 
    [req.params.code], 
    (err, room) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!room) return res.status(404).json({ error: "Room not found" });
      
      if (!room.maxTickets) room.maxTickets = 1;
      
      // Use dynamic status check
      room.aiEnabled = getAiStatus();

      res.json(room);
    }
  );
});

app.put('/api/rooms/:code', (req, res) => {
  const roomCode = req.params.code;
  const { maxTickets } = req.body;

  db.run("UPDATE rooms SET maxTickets = ? WHERE code = ?", [maxTickets, roomCode], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    notifierClients(roomCode, 'update', { refreshSettings: true });
    res.json({ message: "Settings updated", maxTickets });
  });
});

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

// ai check on room announcement
app.put('/api/announcement/:roomCode', async (req, res) => {
  const { texte, couleur, userId } = req.body;
  const roomCode = req.params.roomCode;

  // check safety
  const isSafe = await validateContent(texte);
  if (!isSafe) return res.status(400).json({ error: "Contenu bloqué par le filtre AI (inapproprié)" });

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

app.get('/api/tickets/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  db.all("SELECT * FROM tickets WHERE roomCode = ? ORDER BY dateCreation DESC", [roomCode], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ai check on tickets (name and desc)
app.post('/api/tickets', async (req, res) => {
  const { nom, description, couleur, etat, userId, roomCode } = req.body;
  if (!nom || !userId || !roomCode) return res.status(400).json({ error: 'Missing fields' });

  // check safety for name and description
  const combinedText = `${nom} ${description || ''}`;
  const isSafe = await validateContent(combinedText);
  if (!isSafe) return res.status(400).json({ error: "Ticket bloqué par le filtre AI" });

  db.get("SELECT maxTickets FROM rooms WHERE code = ?", [roomCode], (err, room) => {
    if (!room) return res.status(404).json({ error: "Room not found" });

    const limit = room.maxTickets || 1;

    db.get("SELECT count(*) as count FROM tickets WHERE roomCode = ? AND userId = ? AND etat = 'en cours'", 
      [roomCode, userId], 
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        if (result.count >= limit) {
          return res.status(403).json({ error: `Limit reached (${limit} max)` });
        }

        const id = Date.now().toString();
        const dateCreation = new Date().toISOString();

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
});

// ai check on ticket update
app.put('/api/tickets/:id', async (req, res) => {
  const { nom, description, couleur, etat, roomCode } = req.body;
  const id = req.params.id;

  // check safety only if text fields are present
  if (nom || description) {
      const combinedText = `${nom || ''} ${description || ''}`;
      const isSafe = await validateContent(combinedText);
      if (!isSafe) return res.status(400).json({ error: "Modification bloquée par le filtre AI" });
  }

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

app.get('/api/files/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  db.all("SELECT * FROM files WHERE roomCode = ?", [roomCode], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const usage = rows.reduce((acc, file) => acc + file.size, 0);
    res.json({
      files: rows,
      usage: usage,
      limit: globalSettings.maxRoomSize
    });
  });
});

app.post('/api/files', upload.single('file'), (req, res) => {
  const { roomCode, userId } = req.body;
  const file = req.file;

  if (!file || !roomCode || !userId) {
    if (file) fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Missing file or data' });
  }

  db.get("SELECT SUM(size) as total FROM files WHERE roomCode = ?", [roomCode], (err, row) => {
    if (err) {
      fs.unlinkSync(file.path);
      return res.status(500).json({ error: err.message });
    }

    const currentUsage = row ? row.total || 0 : 0;
    
    if (currentUsage + file.size > globalSettings.maxRoomSize) {
      fs.unlinkSync(file.path);
      return res.status(413).json({ error: 'Room storage quota exceeded' });
    }

    const id = Date.now().toString();
    
    db.run(`INSERT INTO files (id, originalName, encryptedName, mimeType, size, roomCode, userId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, file.originalname, file.filename, file.mimetype, file.size, roomCode, userId],
      (err) => {
        if (err) {
          fs.unlinkSync(file.path);
          return res.status(500).json({ error: err.message });
        }

        updateRoomActivity(roomCode);
        notifierClients(roomCode, 'newFile', { 
          file: { id, originalName: file.originalname, size: file.size, userId } 
        });

        res.status(201).json({ message: 'File uploaded' });
      }
    );
  });
});

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

      const filePath = path.join(UPLOAD_DIR, file.encryptedName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      db.run("DELETE FROM files WHERE id = ?", [fileId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        updateRoomActivity(file.roomCode);
        notifierClients(file.roomCode, 'deleteFile', { fileId });
        res.json({ message: "File deleted" });
      });
  });
});

app.get('/api/announcements/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;

    db.all("SELECT * FROM announcements WHERE roomCode = ? ORDER BY createdAt DESC", [roomCode], (err, annonces) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all("SELECT * FROM files WHERE roomCode = ? AND announcementId IS NOT NULL", [roomCode], (err, files) => {
            if (err) return res.status(500).json({ error: err.message });

            const result = annonces.map(a => {
                return {
                    ...a,
                    files: files.filter(f => f.announcementId === a.id)
                };
            });

            res.json(result);
        });
    });
});

// ai check on new announcement
app.post('/api/announcements', upload.array('files'), async (req, res) => {
    const { roomCode, userId, content, color } = req.body;
    const files = req.files || [];

    // validate content text
    if (content) {
        const isSafe = await validateContent(content);
        if (!isSafe) {
            // cleanup files if rejected
            files.forEach(f => fs.unlinkSync(f.path));
            return res.status(400).json({ error: "Annonce bloquée par le filtre AI" });
        }
    }

    if ((!content || content.trim() === "") && files.length === 0) {
        files.forEach(f => fs.unlinkSync(f.path));
        return res.status(400).json({ error: "Announcement cannot be empty (text or file required)" });
    }

    db.get("SELECT adminId FROM rooms WHERE code = ?", [roomCode], (err, room) => {
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (room.adminId !== userId) {
            files.forEach(f => fs.unlinkSync(f.path));
            return res.status(403).json({ error: "Not authorized" });
        }

        const id = Date.now().toString();
        const now = new Date().toISOString();

        db.run(`INSERT INTO announcements (id, roomCode, userId, content, color, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, roomCode, userId, content || "", color || "#cdcdcd", now],
            (err) => {
                if (err) {
                    files.forEach(f => fs.unlinkSync(f.path));
                    return res.status(500).json({ error: err.message });
                }

                if (files.length > 0) {
                    const stmt = db.prepare(`INSERT INTO files (id, originalName, encryptedName, mimeType, size, roomCode, userId, announcementId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                    
                    files.forEach(f => {
                        const fileId = Date.now().toString() + Math.round(Math.random() * 1000);
                        stmt.run(fileId, f.originalname, f.filename, f.mimetype, f.size, roomCode, userId, id);
                    });
                    stmt.finalize();
                }

                updateRoomActivity(roomCode);
                notifierClients(roomCode, 'updateAnnonce');
                res.status(201).json({ message: "Announcement created" });
            }
        );
    });
});

app.delete('/api/announcements/:id/files/:fileId', (req, res) => {
  const { userId } = req.query;
  const { id, fileId } = req.params;

  const query = `
    SELECT f.*, r.adminId, r.code as roomCode 
    FROM files f 
    JOIN announcements a ON f.announcementId = a.id 
    JOIN rooms r ON a.roomCode = r.code 
    WHERE f.id = ? AND a.id = ?
  `;

  db.get(query, [fileId, id], (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!data) return res.status(404).json({ error: "File or Announcement not found" });

    if (data.adminId !== userId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const filePath = path.join(UPLOAD_DIR, data.encryptedName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.run("DELETE FROM files WHERE id = ?", [fileId], (err) => {
      if (err) return res.status(500).json({ error: err.message });

      updateRoomActivity(data.roomCode);
      notifierClients(data.roomCode, 'updateAnnonce');
      res.json({ message: "File deleted from announcement" });
    });
  });
});

app.delete('/api/announcements/:id', (req, res) => {
    const { userId } = req.query;
    const id = req.params.id;

    db.get("SELECT a.*, r.adminId as roomAdminId FROM announcements a JOIN rooms r ON a.roomCode = r.code WHERE a.id = ?", [id], (err, item) => {
        if (!item) return res.status(404).json({ error: "Announcement not found" });
        
        if (item.roomAdminId !== userId) return res.status(403).json({ error: "Not authorized" });
        db.all("SELECT * FROM files WHERE announcementId = ?", [id], (err, files) => {
            if (files) {
                files.forEach(f => {
                    const p = path.join(UPLOAD_DIR, f.encryptedName);
                    if (fs.existsSync(p)) fs.unlinkSync(p);
                });
            }

            db.run("DELETE FROM files WHERE announcementId = ?", [id], (err) => {
                db.run("DELETE FROM announcements WHERE id = ?", [id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    updateRoomActivity(item.roomCode);
                    notifierClients(item.roomCode, 'updateAnnonce');
                    res.json({ message: "Announcement deleted" });
                });
            });
        });
    });
});

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
        db.get("SELECT count(*) as count FROM tickets WHERE roomCode = ?", [room.code], (err, row) => {
          if (row && row.count === 0) {
            db.all("SELECT * FROM files WHERE roomCode = ?", [room.code], (err, files) => {
              if (files) {
                files.forEach(f => {
                  const p = path.join(UPLOAD_DIR, f.encryptedName);
                  if (fs.existsSync(p)) fs.unlinkSync(p);
                });
                db.run("DELETE FROM files WHERE roomCode = ?", [room.code]);
              }

              db.run("DELETE FROM announcements WHERE roomCode = ?", [room.code]);
              db.run("DELETE FROM rooms WHERE code = ?", room.code, () => {
                console.log(`Room ${room.code} deleted (inactive)`);
                notifierClients(null, 'adminUpdate'); 
              });
            });
          }
        });
      }
    });
  });
}

setInterval(() => {
  supprimerTicketsExpires();
  supprimerRoomsInactives();
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API OK sur port ${PORT}`));