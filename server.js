const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// [수정] 모든 도메인 접속 허용 (가장 확실한 설정)
app.use(cors());

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'] // 연결 안정성 확보
});

app.get('/', (req, res) => { res.send('Cockroach Server is Live'); });

let rooms = {};

io.on('connection', (socket) => {
    console.log('새로운 유저 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!roomCode || !userName) return;
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY' };
        }
        const room = rooms[roomCode];
        
        // 중복 방지 (기존 소켓 아이디가 없을 때만 추가)
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], handCount: 0 });
        }
        
        console.log(`[방 ${roomCode}] ${userName} 입장 성공`);
        // 중요: 방 전체에 알림 (본인 포함)
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.gameState = 'GAME';
            io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('disconnect', () => { console.log('유저 접속 종료'); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
