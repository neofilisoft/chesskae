const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// roomCode -> { hostId, guestId, hostColor, turnColor, status, ply }
const rooms = new Map();
const TURN_TIME_MS = 90 * 1000;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to create a unique room code');
}

function playerColor(room, socketId) {
  if (socketId === room.hostId) return room.hostColor;
  if (socketId === room.guestId) return room.hostColor === 'white' ? 'black' : 'white';
  return null;
}

function closeRoom(code, room, message) {
  clearRoomTimer(room);
  io.to(code).emit('playerDisconnected', message || 'ฝ่ายตรงข้ามออกจากเกม');
  rooms.delete(code);
}

function clearRoomTimer(room) {
  if (room && room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function armRoomTimer(code, room) {
  clearRoomTimer(room);
  room.turnDeadline = Date.now() + TURN_TIME_MS;
  room.timer = setTimeout(() => {
    if (rooms.get(code) !== room || room.status !== 'playing') return;
    const loser = room.turnColor;
    const winner = loser === 'white' ? 'black' : 'white';
    room.status = 'finished';
    clearRoomTimer(room);
    io.to(code).emit('gameTimeout', { loser, winner, reason: 'Time Out' });
  }, TURN_TIME_MS + 25);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', (data) => {
    const color = data && (data.color === 'black' || data.color === 'white') ? data.color : 'white';
    const roomCode = generateRoomCode();

    rooms.set(roomCode, {
      hostId: socket.id,
      hostColor: color,
      guestId: null,
      status: 'waiting',
      turnColor: 'white',
      ply: 0,
      turnDeadline: null,
      timer: null
    });

    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
    console.log(`Room ${roomCode} created by ${socket.id} (color: ${color})`);
  });

  socket.on('joinRoom', (codeRaw) => {
    const code = String(codeRaw || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('joinedRoomFailed', 'ไม่พบห้องนี้');
    }
    if (room.status !== 'waiting' || room.guestId) {
      return socket.emit('joinedRoomFailed', 'ห้องเต็มแล้ว');
    }
    if (room.hostId === socket.id) {
      return socket.emit('joinedRoomFailed', 'คุณเป็นเจ้าของห้องนี้อยู่แล้ว');
    }

    room.guestId = socket.id;
    room.status = 'playing';
    armRoomTimer(code, room);
    socket.join(code);

    io.to(code).emit('startGame', {
      roomCode: code,
      hostColor: room.hostColor,
      players: {
        [room.hostId]: room.hostColor,
        [room.guestId]: room.hostColor === 'white' ? 'black' : 'white'
      },
      turnColor: room.turnColor,
      turnDeadline: room.turnDeadline,
      turnTimeMs: TURN_TIME_MS
    });

    console.log(`User ${socket.id} joined room ${code}`);
  });

  socket.on('makeMove', (data) => {
    if (!data || !data.code || !data.move) return;
    const code = String(data.code).trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;
    if (Date.now() >= room.turnDeadline) {
      const loser = room.turnColor;
      const winner = loser === 'white' ? 'black' : 'white';
      room.status = 'finished';
      clearRoomTimer(room);
      return io.to(code).emit('gameTimeout', { loser, winner, reason: 'Time Out' });
    }
    const color = playerColor(room, socket.id);
    if (!color || color !== room.turnColor) return;
    // The client validates chess legality. The server additionally enforces seats and turn order.
    if (!data.move.from || !data.move.to || data.move.color !== (color === 'white' ? 'w' : 'b')) return;
    room.turnColor = room.turnColor === 'white' ? 'black' : 'white';
    room.ply += 1;
    armRoomTimer(code, room);
    socket.to(code).emit('moveMade', { move: data.move, ply: room.ply });
    io.to(code).emit('clockUpdate', {
      turnColor: room.turnColor,
      turnDeadline: room.turnDeadline,
      ply: room.ply
    });
  });

  socket.on('requestNewGame', (data) => {
    if (!data || !data.code) return;
    const room = rooms.get(data.code);
    if (!room) return;
    if (socket.id !== room.hostId && socket.id !== room.guestId) return;
    room.status = 'playing';
    room.turnColor = 'white';
    room.ply = 0;
    armRoomTimer(data.code, room);
    io.to(data.code).emit('newGameRequested', {
      turnColor: room.turnColor,
      turnDeadline: room.turnDeadline,
      turnTimeMs: TURN_TIME_MS
    });
  });

  socket.on('cancelRoom', (codeRaw) => {
    const code = String(codeRaw || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.status !== 'waiting') return;
    socket.leave(code);
    rooms.delete(code);
    socket.emit('roomCancelled');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);

    for (const [code, room] of rooms.entries()) {
      if (room.hostId === socket.id || room.guestId === socket.id) {
        closeRoom(code, room);
        console.log(`Room ${code} closed`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chesskae server running at http://localhost:${PORT}`);
});
