// signaling-server.js
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';

// === boilerplate for __dirname in ESM ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === config ===
const PORT = process.env.SIGNALING_PORT || 8080;
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',') // e.g. "https://foo.com,https://bar.com"
  : ['*']; // use specific list in prod

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// === Express setup ===
const app = express();

// CORS for REST endpoints
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  })
);

// For parsing form data in file upload
// multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// serve uploaded files
app.use('/files', express.static(UPLOAD_DIR));

// optional health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// file upload fallback endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

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

  res.json({
    fileUrl,
    originalName: req.file.originalname
  });
});

// === HTTP + Socket.IO ===
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// roomName => Set of socket ids
const rooms = new Map();

io.on('connection', socket => {
  console.log('Client connected', socket.id);

  socket.on('join-room', ({ room, userId }) => {
    socket.data.userId = userId || socket.id;
    socket.join(room);

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);

    console.log(`${socket.data.userId} joined room "${room}" (${rooms.get(room).size} participants)`);

    // inform existing peers
    socket.to(room).emit('peer-joined', {
      peerId: socket.id,
      userId: socket.data.userId
    });

    // updated participant list
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
      fileUrl: fileUrl || null,
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

// start
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
