const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS 설정을 닷홈 주소에 맞게 명시적으로 수정
const io = new Server(server, {
    cors: {
        origin: ["https://masi4882.dothome.co.kr", "http://masi4882.dothome.co.kr"],
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true // 호환성 향상
});

let rooms = {};

io.on('connection', (socket) => {
    console.log('유저 접속됨:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY' };
        }
        const room = rooms[roomCode];
        // 중복 추가 방지
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], handCount: 0 });
        }
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.gameState = 'GAME';
            io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('disconnect', () => {
        console.log('접속 끊김:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
