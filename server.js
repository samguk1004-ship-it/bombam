const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041042.png' },
    { id: 'bat', name: '박쥐', color: '#334155', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041046.png' },
    { id: 'fly', name: '파리', color: '#15803d', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041045.png' },
    { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041051.png' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041049.png' },
    { id: 'rat', name: '쥐', color: '#57534e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041044.png' },
    { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://cdn-icons-png.flaticon.com/512/3026/3026335.png' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041047.png' },
    { id: 'mosquito', name: '모기', color: '#dc2626', img: 'https://cdn-icons-png.flaticon.com/512/1574/1574160.png' },
    { id: 'snake', name: '뱀', color: '#16a34a', img: 'https://cdn-icons-png.flaticon.com/512/2929/2929554.png' }
];

const rooms = {};

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], phase: 'LOBBY', turnId: null, activeOffer: null, revealData: null, loserId: null };
        }
        if(!rooms[roomCode].players.find(p => p.id === socket.id)) {
            rooms[roomCode].players.push({ id: socket.id, name: userName, hand: [], penalties: [], handCount: 0 });
        }
        io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        const useAnimals = room.players.length >= 7 ? ANIMALS : ANIMALS.slice(0, 8);
        let deck = [];
        useAnimals.forEach(a => {
            for(let i=0; i<8; i++) deck.push({ ...a, inst: a.id + '_' + Math.random() });
        });
        deck.sort(() => Math.random() - 0.5);

        room.players.forEach(p => { p.hand = []; p.penalties = []; });
        
        let pIdx = 0;
        while(deck.length > 0) {
            room.players[pIdx].hand.push(deck.pop());
            pIdx = (pIdx + 1) % room.players.length;
        }
        
        room.players.forEach(p => p.handCount = p.hand.length);
        room.phase = 'GAME';
        room.turnId = room.players[0].id;
        room.loserId = null;
        io.to(roomCode).emit('gameStarted', room);
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if(!room) return;
        const player = room.players.find(p => p.id === socket.id);
        player.hand = player.hand.filter(c => c.inst !== card.inst);
        player.handCount = player.hand.length;

        room.activeOffer = { originalSenderId: socket.id, seenIds: [socket.id], receiverId: targetId, card, claim };
        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if(!room || !room.activeOffer) return;
        room.activeOffer.seenIds.push(socket.id);
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if(!room || !room.activeOffer) return;

        const { card, claim, receiverId, seenIds } = room.activeOffer;
        const isTrue = card.name === claim;
        const guessCorrect = (guessIsTrue === isTrue);
        
        const lastSenderId = seenIds[seenIds.length - 1];
        const finalPenaltyId = guessCorrect ? lastSenderId : receiverId;

        room.revealData = { guessCorrect, actualCard: card, penaltyId: finalPenaltyId };
        room.phase = 'REVEAL';
        io.to(roomCode).emit('revealStart', room);

        setTimeout(() => {
            const p = room.players.find(x => x.id === finalPenaltyId);
            let isGameOver = false;

            if(p) {
                p.penalties.push(card);
                
                // 🛑 동일한 동물 카드 ID가 4장 이상 모였는지 정확히 체크
                const countById = {};
                p.penalties.forEach(c => {
                    countById[c.id] = (countById[c.id] || 0) + 1;
                });
                
                const hasFourSame = Object.values(countById).some(count => count >= 4);

                if (hasFourSame) {
                    isGameOver = true;
                }
                // 손패가 0장인 경우 패배
                if (p.hand.length === 0) {
                    isGameOver = true;
                }
            }

            if(isGameOver) {
                room.phase = 'GAME_OVER';
                room.loserId = finalPenaltyId;
            } else {
                room.phase = 'IDLE';
                room.turnId = finalPenaltyId;
            }
            
            room.activeOffer = null;
            room.revealData = null;
            io.to(roomCode).emit('roundResolved', room);
        }, 3500);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
