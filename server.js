const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['polling', 'websocket'] 
});

app.get('/', (req, res) => { res.send('Cockroach Poker Server is Live'); });

const ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041042.png' },
    { id: 'bat', name: '박쥐', color: '#334155', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041046.png' },
    { id: 'fly', name: '파리', color: '#15803d', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041045.png' },
    { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041051.png' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041049.png' },
    { id: 'rat', name: '쥐', color: '#57534e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041044.png' },
    { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://cdn-icons-png.flaticon.com/512/3026/3026335.png' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041047.png' }
];

let rooms = {};

io.on('connection', (socket) => {
    console.log('🟢 유저 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!roomCode || !userName) return;
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], phase: 'LOBBY' };
        }
        const room = rooms[roomCode];
        
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], handCount: 0, hand: [] });
        }
        
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.phase = 'GAME';

        let deck = [];
        let instId = 0;
        ANIMALS.forEach(animal => {
            for(let i = 0; i < 8; i++) deck.push({ ...animal, inst: instId++ });
        });

        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        room.players.forEach(p => p.hand = []);
        let pIdx = 0;
        while(deck.length > 0) {
            room.players[pIdx % room.players.length].hand.push(deck.pop());
            pIdx++;
        }

        room.turnId = room.players[0].id;

        room.players.forEach(p => { p.handCount = p.hand.length; });

        io.to(roomCode).emit('gameStarted', room);
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if(!room) return;

        const sender = room.players.find(p => p.id === socket.id);
        if(sender) {
            sender.hand = sender.hand.filter(c => c.inst !== card.inst);
            sender.handCount = sender.hand.length;
        }

        room.activeOffer = {
            originId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim,
            seenIds: [socket.id]
        };
        
        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if(!room || !room.activeOffer) return;

        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        room.activeOffer.seenIds.push(socket.id);

        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    // 👇 핵심 수정: 진실/거짓 판독 시 애니메이션(REVEAL) 딜레이 생성
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if(!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const isTruth = (offer.card.name === offer.claim);
        const guessCorrect = (guessIsTrue === isTruth);

        const attackerId = offer.seenIds[offer.seenIds.length - 1];
        let penaltyReceiverId = guessCorrect ? attackerId : socket.id;

        room.phase = 'REVEAL';
        room.revealData = {
            guessCorrect: guessCorrect,
            actualCard: offer.card,
            penaltyId: penaltyReceiverId
        };

        // 전체 유저에게 카드 뒤집기 애니메이션을 재생하라고 신호 전달
        io.to(roomCode).emit('revealStart', room);

        // 4.5초 뒤에 카드를 벌칙칸에 넣고 다음 턴으로 전환
        setTimeout(() => {
            if (rooms[roomCode]) {
                const penalizedPlayer = rooms[roomCode].players.find(p => p.id === penaltyReceiverId);
                if(penalizedPlayer) penalizedPlayer.penalties.push(offer.card);

                rooms[roomCode].turnId = penaltyReceiverId;
                rooms[roomCode].activeOffer = null;
                rooms[roomCode].revealData = null;
                rooms[roomCode].phase = 'IDLE';

                io.to(roomCode).emit('roundResolved', rooms[roomCode]);
            }
        }, 4500);
    });

    socket.on('disconnect', () => { console.log('🔴 유저 접속 종료:', socket.id); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
