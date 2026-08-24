const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

const animalMap = {
    'cockroach': '바퀴벌레', 'bat': '박쥐', 'fly': '파리', 'toad': '두꺼비',
    'scorpion': '전갈', 'rat': '쥐', 'spider': '거미', 'stinkbug': '노린재',
    'mosquito': '모기', 'snake': '뱀'
};

const BASE_ANIMALS = ['cockroach', 'bat', 'fly', 'toad', 'scorpion', 'rat', 'spider', 'stinkbug'];
const EXTENDED_ANIMALS = [...BASE_ANIMALS, 'mosquito', 'snake'];

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                roomCode, players: [], phase: 'IDLE', turnId: null,
                activeOffer: null, revealData: null
            };
        }
        
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id, name: userName, ready: false,
                hand: [], penalties: [], handCount: 0
            });
        }
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) player.ready = ready;
            io.to(roomCode).emit('roomUpdate', room);
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.phase = 'IDLE';
            room.turnId = room.players[0].id; // 방장이 선공
            
            // 🌟 2~6인(8종 64장), 7~8인(10종 80장) 덱 생성 로직 적용
            const isExtended = room.players.length >= 7;
            const animalsToUse = isExtended ? EXTENDED_ANIMALS : BASE_ANIMALS;
            
            // 동물별로 8장씩 덱에 추가
            let deck = [];
            animalsToUse.forEach(animalId => {
                for (let i = 0; i < 8; i++) {
                    deck.push({
                        id: animalId,
                        name: animalMap[animalId],
                        inst: `${animalId}_${i}_${Math.random()}` 
                    });
                }
            });

            // 덱 셔플 (Fisher-Yates)
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            
            // 인원수에 맞게 카드 균등 분배 (나머지는 버려짐)
            const cardsPerPlayer = Math.floor(deck.length / room.players.length);
            
            room.players.forEach((p, index) => {
                p.hand = deck.slice(index * cardsPerPlayer, (index + 1) * cardsPerPlayer);
                p.handCount = p.hand.length;
                p.penalties = [];
            });
            
            io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (room) {
            const attacker = room.players.find(p => p.id === socket.id);
            if(attacker) {
                attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);
                attacker.handCount = attacker.hand.length;
            }
            room.activeOffer = { card: card, claim: claim, receiverId: targetId, seenIds: [socket.id] };
            room.phase = 'RESPONSE';
            io.to(roomCode).emit('onOffer', room);
        }
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (room && room.activeOffer) {
            room.activeOffer.seenIds.push(socket.id);
            room.activeOffer.receiverId = nextTargetId;
            room.activeOffer.claim = newClaim;
            io.to(roomCode).emit('onOffer', room);
        }
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const actualCard = offer.card;
        
        let isActuallyTrue = false;
        if (actualCard.id === offer.claim || actualCard.name === offer.claim) {
            isActuallyTrue = true;
        }
        const guessCorrect = (guessIsTrue === isActuallyTrue);

        const attackerId = offer.seenIds[offer.seenIds.length - 1];
        const receiverId = offer.receiverId;
        const penaltyId = guessCorrect ? attackerId : receiverId;

        room.phase = 'REVEAL';
        room.revealData = { actualCard: actualCard, guessCorrect: guessCorrect, penaltyId: penaltyId };
        
        io.to(roomCode).emit('revealStart', room);

        setTimeout(() => {
            const penalizedPlayer = room.players.find(p => p.id === penaltyId);
            if (penalizedPlayer) {
                penalizedPlayer.penalties.push(actualCard);
            }

            room.activeOffer = null;
            room.revealData = null;
            room.turnId = penaltyId; 
            room.phase = 'IDLE';

            io.to(roomCode).emit('roundResolved', room);
        }, 3500);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
