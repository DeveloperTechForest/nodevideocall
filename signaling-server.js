// signaling-server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);

// Allow CORS from your Laravel frontend origin if it's different
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
    socket.data.userId = userId;
    socket.join(room);
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);
    console.log(`${userId} joined ${room} (${rooms.get(room).size} participants)`);

    socket.to(room).emit('peer-joined', { peerId: socket.id, userId });
  });

  socket.on('signal', ({ room, to, data }) => {
    // data: offer / answer / ice candidate
    if (to) {
      io.to(to).emit('signal', {
        from: socket.id,
        data,
        userId: socket.data.userId
      });
    } else {
      // broadcast to all except sender
      socket.to(room).emit('signal', {
        from: socket.id,
        data,
        userId: socket.data.userId
      });
    }
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (rooms.has(room)) {
        rooms.get(room).delete(socket.id);
        if (rooms.get(room).size === 0) rooms.delete(room);
        socket.to(room).emit('peer-left', { peerId: socket.id, userId: socket.data.userId });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

const PORT = process.env.SIGNALING_PORT || 8080;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
socket.on('chat-message', ({ room, from, message }) => {
  socket.to(room).emit('chat-message', { from, message });
});