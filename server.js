const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
app.use(cors());

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['polling', 'websocket']
});

app.get('/', (req, res) => { res.send('Cockroach Server is Running'); });

let rooms = {};

io.on('connection', (socket) => {
    console.log('User Connected:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!roomCode || !userName) return;

        socket.join(roomCode);
        
        // 방이 없으면 생성
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                players: [],
                gameState: 'LOBBY',
                turnId: null
            };
        }

        // 중복 입장 방지 (소켓 아이디 기준)
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id,
                name: userName,
                penalties: [],
                handCount: 0
            });
        }

        console.log(`[Room ${roomCode}] ${userName} Joined`);
        
        // [핵심] 방에 있는 '모든 유저'에게 최신 방 정보를 전송
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        // 게임 시작 시 카드 분배 로직 (이전과 동일)
        // ... (100장 덱 생성 및 분배 로직)
        room.gameState = 'GAME';
        io.to(roomCode).emit('gameStarted', room);
    });

    socket.on('disconnecting', () => {
        // 유저가 나갈 때 방 정보 갱신
        socket.rooms.forEach(roomCode => {
            if (rooms[roomCode]) {
                rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
                io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
