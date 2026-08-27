const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// ==========================================
// 🃏 [1] 바퀴벌레 포커 전용 공간 (Namespace: /poker)
// ==========================================
const pokerIo = io.of('/poker');
const pokerRooms = {};

pokerIo.on('connection', (socket) => {
    console.log('바퀴벌레 포커 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        socket.join(roomCode);
        if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [] };
        const room = pokerRooms[roomCode];
        
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id, userId, name: userName, isBot,
                ready: room.players.length === 0, 
                score: 0
            });
        }
        pokerIo.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = pokerRooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.ready = ready;
                pokerIo.to(roomCode).emit('roomUpdate', room);
            }
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = pokerRooms[roomCode];
        if (room && room.players[0].id === socket.id) {
            room.phase = 'PLAYING';
            pokerIo.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('leaveRoom', (roomCode) => leavePokerRoom(socket, roomCode));
    socket.on('disconnect', () => {
        for (const roomCode in pokerRooms) leavePokerRoom(socket, roomCode);
    });
});

function leavePokerRoom(socket, roomCode) {
    const room = pokerRooms[roomCode];
    if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        socket.leave(roomCode);
        if (room.players.length === 0) {
            delete pokerRooms[roomCode];
        } else {
            room.players[0].ready = true; 
            pokerIo.to(roomCode).emit('roomUpdate', room);
        }
    }
}


// ==========================================
// 🎯 [2] 플립 7 전용 공간 (Namespace: /flip7)
// ==========================================
const flip7Io = io.of('/flip7');
const flip7Rooms = {};

flip7Io.on('connection', (socket) => {
    console.log('플립 7 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        socket.join(roomCode);
        if (!flip7Rooms[roomCode]) flip7Rooms[roomCode] = { roomCode, phase: 'LOBBY', players: [] };
        const room = flip7Rooms[roomCode];
        
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id, userId, name: userName, isBot,
                ready: room.players.length === 0, 
                score: 0
            });
        }
        flip7Io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = flip7Rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.ready = ready;
                flip7Io.to(roomCode).emit('roomUpdate', room);
            }
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = flip7Rooms[roomCode];
        if (room && room.players[0].id === socket.id) {
            room.phase = 'PLAYING';
            flip7Io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('leaveRoom', (roomCode) => leaveFlip7Room(socket, roomCode));
    socket.on('disconnect', () => {
        for (const roomCode in flip7Rooms) leaveFlip7Room(socket, roomCode);
    });
});

function leaveFlip7Room(socket, roomCode) {
    const room = flip7Rooms[roomCode];
    if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        socket.leave(roomCode);
        if (room.players.length === 0) {
            delete flip7Rooms[roomCode];
        } else {
            room.players[0].ready = true; 
            flip7Io.to(roomCode).emit('roomUpdate', room);
        }
    }
}

// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 봄밤놀이터 통합 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
