const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors'); // cors 패키지 활용

const app = express();
const server = http.createServer(app);

// 1. Express용 CORS 설정
app.use(cors());

// 2. Socket.io용 CORS 설정 (가장 중요)
const io = new Server(server, {
    cors: {
        origin: "*", // 모든 주소 허용 (테스트용 최강 설정)
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});

// 서버 상태 확인용 테스트 경로
app.get('/', (req, res) => {
    res.send('서버가 정상적으로 작동 중입니다!');
});

let rooms = {};

io.on('connection', (socket) => {
    console.log('새로운 유저 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY' };
        }
        const room = rooms[roomCode];
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
        console.log('유저 접속 종료');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
