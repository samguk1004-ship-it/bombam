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

// 🌟 카드 이름 매핑 추가 (하드코딩 오류 해결)
const animalMap = {
    'cockroach': '바퀴벌레', 'bat': '박쥐', 'fly': '파리', 'toad': '두꺼비',
    'scorpion': '전갈', 'rat': '쥐', 'spider': '거미', 'stinkbug': '노린재',
    'mosquito': '모기', 'snake': '뱀'
};

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
            
            const animals = ['cockroach', 'bat', 'fly', 'toad', 'scorpion', 'rat', 'spider', 'stinkbug'];
            
            room.players.forEach(p => {
                p.hand = Array(8).fill(null).map((_, i) => {
                    const randomAnimalId = animals[Math.floor(Math.random() * animals.length)];
                    return {
                        id: randomAnimalId,
                        name: animalMap[randomAnimalId], // 🌟 "동물카드" 버그 수정 완료
                        inst: `${p.id}_${i}_${Math.random()}` 
                    };
                });
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
        room.revealData = {
            actualCard: actualCard, guessCorrect: guessCorrect, penaltyId: penaltyId
        };
        io.to(roomCode).emit('revealStart', room);

        setTimeout(() => {
            const penalizedPlayer = room.players.find(p => p.id === penaltyId);
            if (penalizedPlayer) {
                penalizedPlayer.penalties.push(actualCard);
                // 🌟 벌칙 4장 수집 시 게임 오버 판정 로직 추가 가능
            }

            room.activeOffer = null;
            room.revealData = null;
            room.turnId = penaltyId; 
            room.phase = 'IDLE';

            io.to(roomCode).emit('roundResolved', room);
        }, 3500); // 3.5초 애니메이션 대기
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
