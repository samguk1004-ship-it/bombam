const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let rooms = {};

io.on('connection', (socket) => {
    console.log('새 유저 연결:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!roomCode || !userName) return;

        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                code: roomCode, 
                players: [], 
                gameState: 'LOBBY' 
            };
        }

        const room = rooms[roomCode];
        
        // 이미 방에 있는 유저인지 확인 (재접속 처리용)
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (!existingPlayer) {
            room.players.push({
                id: socket.id,
                name: userName,
                penalties: [],
                handCount: 0
            });
        }

        console.log(`[${roomCode}] ${userName} 입장함`);
        
        // 중요: 방금 들어온 본인에게도 정보를 주고, 방 전체에도 알림
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.players.length >= 2) {
            room.gameState = 'GAME';
            io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('disconnect', () => {
        console.log('유저 나감:', socket.id);
        // 여기서 방에서 제거하는 로직은 복잡해질 수 있으므로 우선 유지
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
