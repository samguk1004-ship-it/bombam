const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// [중요] 모든 접속 허용 (CORS 에러 방지)
app.use(cors());

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// [추가] 브라우저에서 주소를 쳤을 때 서버 상태를 확인할 수 있게 합니다.
app.get('/', (req, res) => {
    res.send('<h1>서버가 정상적으로 작동 중입니다!</h1><p>Socket.io가 연결을 기다리고 있습니다.</p>');
});

let rooms = {};

// 동물 데이터 (이미지 포함)
const ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041042.png' },
    { id: 'bat', name: '박쥐', color: '#334155', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041046.png' },
    { id: 'fly', name: '파리', color: '#15803d', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041045.png' },
    { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041051.png' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041049.png' },
    { id: 'rat', name: '쥐', color: '#57534e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041044.png' },
    { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://cdn-icons-png.flaticon.com/512/3026/3026335.png' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041047.png' },
    { id: 'mosquito', name: '모기', color: '#4c0519', img: 'https://cdn-icons-png.flaticon.com/512/2641/2641413.png' },
    { id: 'snake', name: '뱀', color: '#33691e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041048.png' }
];

io.on('connection', (socket) => {
    console.log('유저 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY' };
        }
        // 중복 방지 체크
        if (!rooms[roomCode].players.find(p => p.id === socket.id)) {
            rooms[roomCode].players.push({ id: socket.id, name: userName, penalties: [], hand: [] });
        }
        io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        let deck = [];
        ANIMALS.forEach(a => { for(let i=0; i<8; i++) deck.push({...a, inst: Math.random()}); });
        deck.sort(() => Math.random() - 0.5);

        const cardsPer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            p.hand = deck.slice(idx * cardsPer, (idx + 1) * cardsPer);
            io.to(p.id).emit('yourHand', p.hand);
        });

        room.gameState = 'GAME';
        room.turnId = room.players[0].id;
        io.to(roomCode).emit('gameStarted', room);
    });
});

// [중요] Render 환경에서 제공하는 포트를 사용해야 합니다.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
