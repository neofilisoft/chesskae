const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static(__dirname)); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', (data) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms.set(roomCode, {
            hostId: socket.id,
            hostColor: data.color,
            guestId: null
        });
        
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        console.log(`Room created: ${roomCode} by ${socket.id}`);
    });

    socket.on('joinRoom', (codeRaw) => {
        const code = String(codeRaw || '').trim().toUpperCase();
        const room = rooms.get(code);

    if (!room) {
        return socket.emit('joinedRoomFailed', 'ไม่พบห้องนี้');
    }

    if (room.guestId) {
        return socket.emit('joinedRoomFailed', 'ห้องเต็มแล้ว');
    }

    room.guestId = socket.id;
    socket.join(code);

    io.to(code).emit('startGame', {
        roomCode: code,
        hostColor: room.hostColor
    });

    console.log(`User ${socket.id} joined room ${code}`);
});

    socket.on('makeMove', (data) => {
        socket.to(data.code).emit('moveMade', data.move);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        for (const [code, room] of rooms.entries()) {
            if (room.hostId === socket.id || room.guestId === socket.id) {
                socket.to(code).emit('playerDisconnected');
                rooms.delete(code);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});