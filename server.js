const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.get('/', (req, res) => {
    res.send('<h1>서버 가동 중</h1>');
});

let rooms = {};

io.on('connection', (socket) => {
    console.log('접속:', socket.id);

    // [조인 로직 수정]
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
        
        // 중복 방지 (같은 소켓 ID가 있는지 확인)
        const exists = room.players.find(p => p.id === socket.id);
        if (!exists) {
            room.players.push({
                id: socket.id,
                name: userName,
                penalties: []
            });
        }

        console.log(`${userName} 입장 -> ${roomCode}`);
        
        // 방에 있는 모든 클라이언트에게 업데이트된 방 정보 전송
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('disconnect', () => {
        // 유저가 나갔을 때 방 목록에서 제거하는 로직 (선택 사항)
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
