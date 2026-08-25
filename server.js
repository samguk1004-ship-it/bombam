const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 💡 기본 동물 및 확장 동물 데이터
const BASE_ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', repImg: 'https://masi4882.dothome.co.kr/31.jpg?v=2026' },
    { id: 'bat', name: '박쥐', repImg: 'https://masi4882.dothome.co.kr/51.jpg?v=2026' },
    { id: 'fly', name: '파리', repImg: 'https://masi4882.dothome.co.kr/71.jpg?v=2026' },
    { id: 'toad', name: '두꺼비', repImg: 'https://masi4882.dothome.co.kr/21.jpg?v=2026' },
    { id: 'scorpion', name: '전갈', repImg: 'https://masi4882.dothome.co.kr/41.jpg?v=2026' },
    { id: 'rat', name: '쥐', repImg: 'https://masi4882.dothome.co.kr/61.jpg?v=2026' },
    { id: 'spider', name: '거미', repImg: 'https://masi4882.dothome.co.kr/01.jpg?v=2026' },
    { id: 'stinkbug', name: '노린재', repImg: 'https://masi4882.dothome.co.kr/11.jpg?v=2026' }
];
const EXTENDED_ANIMALS = [ ...BASE_ANIMALS, 
    { id: 'mosquito', name: '모기', repImg: 'https://masi4882.dothome.co.kr/81.jpg?v=2026' }, 
    { id: 'snake', name: '뱀', repImg: 'https://masi4882.dothome.co.kr/91.jpg?v=2026' } 
];

const rooms = {};

function sanitizeRoom(room) { return room; }

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { phase: 'LOBBY', players: [], turnId: null, activeOffer: null, revealData: null };
        }
        const room = rooms[roomCode];
        let player = room.players.find(p => p.userId === userId);
        if (player) {
            player.id = socket.id;
            player.isReconnecting = false;
        } else {
            player = { id: socket.id, userId, name: userName, isBot, ready: false, hand: [], penalties: [], lastClaim: '' };
            room.players.push(player);
        }
        io.to(roomCode).emit('roomUpdate', sanitizeRoom(room));
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const p = room.players.find(p => p.id === socket.id);
        if (p) p.ready = ready;
        io.to(roomCode).emit('roomUpdate', sanitizeRoom(room));
    });
    
    socket.on('leaveRoom', (roomCode) => {
        const room = rooms[roomCode];
        if(!room) return;
        room.players = room.players.filter(p => p.id !== socket.id);
        if(room.players.length === 0) delete rooms[roomCode];
        else io.to(roomCode).emit('roomUpdate', sanitizeRoom(room));
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const p = room.players.find(p => p.id === socket.id);
            if (p) {
                p.isReconnecting = true;
                io.to(code).emit('roomUpdate', sanitizeRoom(room));
            }
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const animals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        let cardInst = 0;
        
        // 💡 핵심: 일반 동물 카드 8장 + 진짜 왕카드 1장 섞어 생성 (동물별로)
        animals.forEach(animal => {
            for(let i=0; i<8; i++) {
                deck.push({ inst: ++cardInst, id: animal.id, name: animal.name, isKing: false, img: animal.repImg, animalName: animal.name });
            }
            deck.push({ inst: ++cardInst, id: animal.id + '_king', name: `왕 ${animal.name}`, isKing: true, img: animal.repImg, animalName: animal.name });
        });

        // 카드 섞기 (셔플)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // 분배하기
        room.players.forEach(p => { p.hand = []; p.penalties = []; p.lastClaim = ''; });
        let pIdx = 0;
        while (deck.length > 0) {
            room.players[pIdx].hand.push(deck.pop());
            pIdx = (pIdx + 1) % room.players.length;
        }
        
        room.players.forEach(p => { p.handCount = p.hand.length; });
        room.phase = 'GAME';
        room.turnId = room.players[0].id;
        room.activeOffer = null;
        room.revealData = null;
        
        io.to(roomCode).emit('gameStarted', sanitizeRoom(room));
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const attacker = room.players.find(p => p.id === socket.id);
        attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);
        attacker.handCount = attacker.hand.length;
        attacker.lastClaim = claim;

        room.activeOffer = { card, claim, receiverId: targetId, seenIds: [socket.id], attackerId: socket.id };
        room.phase = 'RESPONSE';
        
        io.to(roomCode).emit('onOffer', sanitizeRoom(room));
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const passer = room.players.find(p => p.id === socket.id);
        passer.lastClaim = newClaim;

        room.activeOffer.seenIds.push(socket.id);
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        
        io.to(roomCode).emit('onOffer', sanitizeRoom(room));
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        const { card, claim, receiverId, seenIds } = room.activeOffer;
        const attackerId = seenIds[seenIds.length - 1]; 
        
        // 💡 판정 로직: 왕카드를 "왕카드"라고 부르면 진실, "해당 동물"이라고 불러도 진실!
        let isTruth = false;
        if (claim === '왕카드') {
            isTruth = card.isKing;
        } else {
            isTruth = (card.animalName === claim);
        }

        const guessCorrect = (guessIsTrue === isTruth);
        
        let winnerId = guessCorrect ? receiverId : attackerId;
        let penaltyId = guessCorrect ? attackerId : receiverId;

        const winner = room.players.find(p => p.id === winnerId);
        const loser = room.players.find(p => p.id === penaltyId);

        let extraCard = null;
        if (claim === '왕카드') {
            if (winner && winner.penalties.length > 0) {
                const rIdx = Math.floor(Math.random() * winner.penalties.length);
                extraCard = winner.penalties.splice(rIdx, 1)[0];
                loser.penalties.push(extraCard);
            }
        }

        loser.penalties.push(card);
        
        room.revealData = { guessCorrect, actualCard: card, winnerId, penaltyId, extraCard };
        room.phase = 'REVEAL';
        io.to(roomCode).emit('revealStart', sanitizeRoom(room));

        setTimeout(() => {
            const room = rooms[roomCode];
            if(!room) return;
            
            room.activeOffer = null;
            room.revealData = null;
            room.turnId = penaltyId; // 진 사람이 다음 턴 선
            room.phase = 'IDLE';

            const penaltyLimit = room.players.length >= 7 ? 3 : 4;
            let isGameOver = false;
            let overLoserId = null;

            room.players.forEach(p => {
                if (p.hand.length === 0 && room.turnId === p.id) {
                    isGameOver = true;
                    overLoserId = p.id;
                }
                const counts = {};
                p.penalties.forEach(pc => {
                    const baseId = pc.id.replace('_king', ''); 
                    counts[baseId] = (counts[baseId] || 0) + 1;
                    if(counts[baseId] >= penaltyLimit) {
                        isGameOver = true;
                        overLoserId = p.id;
                    }
                });
            });

            if (isGameOver) {
                room.phase = 'GAME_OVER';
                room.loserId = overLoserId;
            }

            io.to(roomCode).emit('roundResolved', sanitizeRoom(room));
        }, 6000); 
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Cockroach Poker Server running on port ${PORT}`);
});
