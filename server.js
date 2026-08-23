const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());

let rooms = {};

// 10종 바퀴벌레 데이터
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

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        // 100장 카드 생성
        let deck = [];
        ANIMALS.forEach(a => {
            for(let i=0; i<10; i++) deck.push({...a, inst: Math.random()});
        });
        deck.sort(() => Math.random() - 0.5);

        // 카드 배분
        const cardsPer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            const hand = deck.slice(idx * cardsPer, (idx + 1) * cardsPer);
            p.handCount = hand.length;
            io.to(p.id).emit('yourHand', hand);
        });

        room.gameState = 'GAME';
        room.turnId = room.players[0].id;
        room.phase = 'IDLE';
        io.to(roomCode).emit('gameStarted', room);
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if(!room) return;
        room.activeOffer = { card, claim, senderId: socket.id, receiverId: targetId, seenIds: [socket.id] };
        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if(!room) return;
        const offer = room.activeOffer;
        const actualIsTrue = offer.card.name === offer.claim;
        const loserId = (guessIsTrue !== actualIsTrue) ? offer.receiverId : offer.senderId;

        room.phase = 'REVEAL';
        io.to(roomCode).emit('revealStart', { room, loserId, win: guessIsTrue === actualIsTrue });

        setTimeout(() => {
            if (!rooms[roomCode]) return;
            const loserP = rooms[roomCode].players.find(p => p.id === loserId);
            loserP.penalties.push(offer.card);
            loserP.handCount = Math.max(0, loserP.handCount); // 로직 간소화

            const counts = loserP.penalties.reduce((acc, c) => { acc[c.id] = (acc[c.id] || 0) + 1; return acc; }, {});
            if (Object.values(counts).some(v => v >= 7)) {
                io.to(roomCode).emit('gameOver', loserP.name);
                delete rooms[roomCode];
            } else {
                rooms[roomCode].turnId = loserId;
                rooms[roomCode].activeOffer = null;
                rooms[roomCode].phase = 'IDLE';
                io.to(roomCode).emit('roundResolved', rooms[roomCode]);
            }
        }, 3000);
    });

    socket.on('leaveRoom', () => {
        // 방 나가기 로직
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
