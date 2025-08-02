// signaling-server.js
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// multer for fallback file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname;
    cb(null, safe);
  }
});
const upload = multer({ storage });

const app = express();
const server = http.createServer(app);

// serve uploaded files
app.use('/files', express.static(UPLOAD_DIR));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map(); // roomName => Set of socket ids

io.on('connection', socket => {
  console.log('Client connected', socket.id);

  socket.on('join-room', ({ room, userId }) => {
    socket.data.userId = userId || socket.id;
    socket.join(room);
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);

    console.log(`${socket.data.userId} joined ${room} (${rooms.get(room).size} participants)`);

    socket.to(room).emit('peer-joined', {
      peerId: socket.id,
      userId: socket.data.userId
    });

    const participants = Array.from(rooms.get(room)).map(id => ({
      socketId: id,
      userId: io.sockets.sockets.get(id)?.data?.userId || null
    }));
    io.to(room).emit('room-participants', { participants });
  });

  socket.on('signal', ({ room, to, data }) => {
    if (to) {
      io.to(to).emit('signal', {
        from: socket.id,
        data,
        userId: socket.data.userId
      });
    } else if (room) {
      socket.to(room).emit('signal', {
        from: socket.id,
        data,
        userId: socket.data.userId
      });
    }
  });

  socket.on('chat-message', ({ room, from, message, fileUrl }) => {
    if (!room) return;
    socket.to(room).emit('chat-message', {
      from,
      message,
      fileUrl,
      timestamp: Date.now()
    });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      if (rooms.has(room)) {
        rooms.get(room).delete(socket.id);
        if (rooms.get(room).size === 0) {
          rooms.delete(room);
        } else {
          socket.to(room).emit('peer-left', {
            peerId: socket.id,
            userId: socket.data.userId
          });
          const participants = Array.from(rooms.get(room)).map(id => ({
            socketId: id,
            userId: io.sockets.sockets.get(id)?.data?.userId || null
          }));
          io.to(room).emit('room-participants', { participants });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

// fallback file upload
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const fileUrl = `/files/${req.file.filename}`;
  const { room, from } = req.body;
  if (room) {
    io.to(room).emit('chat-message', {
      from: from || 'system',
      message: `File available: ${req.file.originalname}`,
      fileUrl,
      timestamp: Date.now()
    });
  }
  res.json({ fileUrl, originalName: req.file.originalname });
});

const PORT = process.env.SIGNALING_PORT || 8080;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
