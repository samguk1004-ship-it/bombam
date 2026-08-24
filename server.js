const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

const BASE_ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f' },
    { id: 'bat', name: '박쥐', color: '#334155' },
    { id: 'fly', name: '파리', color: '#15803d' },
    { id: 'toad', name: '두꺼비', color: '#065f46' },
    { id: 'scorpion', name: '전갈', color: '#991b1b' },
    { id: 'rat', name: '쥐', color: '#57534e' },
    { id: 'spider', name: '거미', color: '#1e1b4b' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e' }
];

const EXTENDED_ANIMALS = [
    ...BASE_ANIMALS,
    { id: 'mosquito', name: '모기', color: '#dc2626' },
    { id: 'snake', name: '뱀', color: '#16a34a' }
];

io.on('connection', (socket) => {
    console.log(`사용자 접속: ${socket.id}`);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                roomCode,
                players: [],
                phase: 'LOBBY',
                turnId: null,
                activeOffer: null,
                loserId: null
            };
        }

        const room = rooms[roomCode];
        let player = room.players.find(p => p.id === socket.id);
        if (!player) {
            player = {
                id: socket.id,
                name: userName,
                ready: false,
                hand: [],
                handCount: 0,
                penalties: []
            };
            room.players.push(player);
        }

        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = ready;
        }

        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        room.phase = 'PLAYING';
        
        const animalList = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        let instCounter = 1;

        animalList.forEach(animal => {
            const count = 8; 
            for (let i = 0; i < count; i++) {
                deck.push({
                    inst: `card_${instCounter++}`,
                    id: animal.id,
                    name: animal.name,
                    color: animal.color
                });
            }
        });

        deck.sort(() => Math.random() - 0.5);

        const cardsPerPlayer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            p.hand = deck.slice(idx * cardsPerPlayer, (idx + 1) * cardsPerPlayer);
            p.handCount = p.hand.length;
            p.penalties = [];
            p.ready = false;
        });

        room.turnId = room.players[0].id;
        room.activeOffer = null;

        io.to(roomCode).emit('gameStarted', room);
    });

    // 공격 제안 제출
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room || !card) return;

        const attacker = room.players.find(p => p.id === socket.id);
        if (!attacker) return;

        // 손패에서 카드 제거
        attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);
        attacker.handCount = attacker.hand.length;

        room.activeOffer = {
            attackerId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim || card.name,
            seenIds: [socket.id]
        };

        io.to(roomCode).emit('onOffer', room);
    });

    // 카드 넘기기(Pass) 제출 핸들러 (누락 방지 수정)
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        const currentReceiverId = room.activeOffer.receiverId;
        if (!room.activeOffer.seenIds.includes(currentReceiverId)) {
            room.activeOffer.seenIds.push(currentReceiverId);
        }

        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim || room.activeOffer.claim;

        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const isActualTruth = (offer.card.name === offer.claim);
        const guessCorrect = (guessIsTrue === isActualTruth);

        let penaltyId = guessCorrect ? offer.attackerId : offer.receiverId;

        const penaltyTarget = room.players.find(p => p.id === penaltyId);
        if (penaltyTarget) {
            penaltyTarget.penalties.push(offer.card);
        }

        room.phase = 'REVEAL';
        room.revealData = {
            guessCorrect,
            actualCard: offer.card,
            penaltyId
        };

        io.to(roomCode).emit('revealStart', room);

        setTimeout(() => {
            for (const p of room.players) {
                const counts = {};
                p.penalties.forEach(c => {
                    counts[c.id] = (counts[c.id] || 0) + 1;
                    if (counts[c.id] >= 4 || p.hand.length === 0) {
                        room.phase = 'GAME_OVER';
                        room.loserId = p.id;
                    }
                });
            }

            if (room.phase !== 'GAME_OVER') {
                room.phase = 'PLAYING';
                room.turnId = penaltyId; 
                room.activeOffer = null;
                room.revealData = null;
            }

            io.to(roomCode).emit('roundResolved', room);
        }, 4000);
    });

    socket.on('disconnect', () => {
        console.log(`사용자 퇴장: ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('roomUpdate', room);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
