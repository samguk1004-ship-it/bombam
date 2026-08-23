const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// 모든 도메인 허용
app.use(cors());

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// 서버 상태 확인용
app.get('/', (req, res) => {
    res.send('<h1>서버 작동 중</h1>');
});

let rooms = {};

io.on('connection', (socket) => {
    console.log('유저 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!roomCode || !userName) return;
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY' };
        }
        
        // 중복 추가 방지
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [] });
        }
        
        console.log(`[${roomCode}] ${userName} 입장`);
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('disconnect', () => {
        console.log('유저 나감');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
