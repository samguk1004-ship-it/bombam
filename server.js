const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
app.use(cors());

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let rooms = {};

// 10종 동물 데이터
const ANIMALS = [
    { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041047.png' },
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041042.png' },
    { id: 'bat', name: '박쥐', color: '#334155', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041046.png' },
    { id: 'fly', name: '파리', color: '#15803d', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041045.png' },
    { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041051.png' },
    { id: 'rat', name: '쥐', color: '#57534e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041044.png' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041049.png' },
    { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://cdn-icons-png.flaticon.com/512/3026/3026335.png' },
    { id: 'mosquito', name: '모기', color: '#4c0519', img: 'https://cdn-icons-png.flaticon.com/512/2641/2641413.png' },
    { id: 'snake', name: '뱀', color: '#33691e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041048.png' }
];

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY', turnId: null, activeOffer: null };
        }
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], handCount: 0 });
        }
        io.to(roomCode).emit('roomUpdate', room);
    });

    // [게임 시작 로직]
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 1) return; // 테스트를 위해 1명도 가능하게 설정

        // 10종 x 10장 = 100장 생성 및 셔플
        let deck = [];
        ANIMALS.forEach(a => {
            for(let i=0; i<10; i++) deck.push({...a, inst: Math.random()});
        });
        deck.sort(() => Math.random() - 0.5);

        // 카드 분배
        const cardsPer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            const hand = deck.slice(idx * cardsPer, (idx + 1) * cardsPer);
            p.handCount = hand.length;
            io.to(p.id).emit('yourHand', hand); // 각자에게 본인 카드 전송
        });

        room.gameState = 'GAME';
        room.turnId = room.players[0].id; // 방장이 첫 턴
        room.phase = 'IDLE';
        io.to(roomCode).emit('gameStarted', room);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
