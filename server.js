const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 💡 동물 번호(prefix) 부여 (0~9)
const BASE_ANIMALS = [
    { id: 'spider', name: '거미', prefix: '0' },
    { id: 'stinkbug', name: '노린재', prefix: '1' },
    { id: 'toad', name: '두꺼비', prefix: '2' },
    { id: 'cockroach', name: '바퀴벌레', prefix: '3' },
    { id: 'scorpion', name: '전갈', prefix: '4' },
    { id: 'bat', name: '박쥐', prefix: '5' },
    { id: 'rat', name: '쥐', prefix: '6' },
    { id: 'fly', name: '파리', prefix: '7' }
];
const EXTENDED_ANIMALS = [ ...BASE_ANIMALS, 
    { id: 'mosquito', name: '모기', prefix: '8' }, 
    { id: 'snake', name: '뱀', prefix: '9' } 
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
        
        // 2~6인은 8종, 7~8인은 10종
        const animals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        let cardInst = 0;
        
        // 💡 00~99 이미지 할당 및 왕카드(0번) 지정 로직
        animals.forEach(animal => {
            // 동물별로 8장의 카드를 생성 (0~7번 인덱스 사용)
            for(let i = 0; i < 8; i++) {
                const isKing = (i === 0); // 💡 수정 완료: 0번 카드가 왕카드!
                const cardNumStr = `${animal.prefix}${i}`; // 예: "00", "01", "02"...
                
                deck.push({ 
                    inst: ++cardInst, 
                    id: isKing ? `${animal.id}_king` : animal.id, 
                    name: isKing ? `왕 ${animal.name}` : animal.name, 
                    isKing: isKing, 
                    img: `https://masi4882.dothome.co.kr/${cardNumStr}.jpg?v=2026`, 
                    animalName: animal.name 
                });
            }
        });

        // 카드 섞기
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
            room.turnId = penaltyId; 
            room.phase = 'IDLE';

            // 💡 패배 조건 1: 인원수 비례 벌칙 개수 (7인이상은 3장, 이하는 4장)
            const penaltyLimit = room.players.length >= 7 ? 3 : 4;
            let isGameOver = false;
            let overLoserId = null;

            room.players.forEach(p => {
                // 💡 패배 조건 2: 턴이 시작되었는데 내 손패가 0장일 때 패배
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
