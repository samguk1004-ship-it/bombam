const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 20%;">
            <h1 style="color: #4ade80;">✅ 게임 서버 정상 작동 중!</h1>
            <p>포커와 플립7 모두 접속 가능한 상태입니다.</p>
        </div>
    `);
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST", "OPTIONS"] },
    pingTimeout: 60000, 
    pingInterval: 25000,
    connectTimeout: 45000,
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

// ==========================================
// 🃏 [1] 바퀴벌레 포커 전용 (Namespace: /poker)
// ==========================================
const pokerIo = io.of('/poker');
const pokerRooms = {};

const BASE_ANIMALS = [
    { id: 'spider', name: '거미', prefix: '0', repImg: 'https://masi4882.dothome.co.kr/01.jpg?v=2026' },
    { id: 'stinkbug', name: '노린재', prefix: '1', repImg: 'https://masi4882.dothome.co.kr/11.jpg?v=2026' },
    { id: 'toad', name: '두꺼비', prefix: '2', repImg: 'https://masi4882.dothome.co.kr/21.jpg?v=2026' },
    { id: 'cockroach', name: '바퀴벌레', prefix: '3', repImg: 'https://masi4882.dothome.co.kr/31.jpg?v=2026' },
    { id: 'scorpion', name: '전갈', prefix: '4', repImg: 'https://masi4882.dothome.co.kr/41.jpg?v=2026' },
    { id: 'bat', name: '박쥐', prefix: '5', repImg: 'https://masi4882.dothome.co.kr/51.jpg?v=2026' },
    { id: 'rat', name: '쥐', prefix: '6', repImg: 'https://masi4882.dothome.co.kr/61.jpg?v=2026' },
    { id: 'fly', name: '파리', prefix: '7', repImg: 'https://masi4882.dothome.co.kr/71.jpg?v=2026' }
];
const EXTENDED_ANIMALS = [ ...BASE_ANIMALS, 
    { id: 'mosquito', name: '모기', prefix: '8', repImg: 'https://masi4882.dothome.co.kr/81.jpg?v=2026' }, 
    { id: 'snake', name: '뱀', prefix: '9', repImg: 'https://masi4882.dothome.co.kr/91.jpg?v=2026' } 
];

pokerIo.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [] };
            const room = pokerRooms[roomCode];
            
            if (!room.players.find(p => p.id === socket.id)) {
                room.players.push({
                    id: socket.id, userId, name: userName, isBot,
                    ready: room.players.length === 0, 
                    score: 0, hand: [], penalties: [], handCount: 0
                });
            }
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = pokerRooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; pokerIo.to(roomCode).emit('roomUpdate', room); }
            }
        } catch(e) {}
    });

    socket.on('startGame', (roomCode) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || room.players.length === 0) return;
            if (room.players[0].id !== socket.id) return; 

            const isExtended = room.players.length >= 7;
            const useAnimals = isExtended ? EXTENDED_ANIMALS : BASE_ANIMALS;
            const cardsPerAnimal = isExtended ? 10 : 8; 
            
            let deck = [];
            useAnimals.forEach(animal => {
                for (let i = 0; i < cardsPerAnimal; i++) {
                    const imgNum = i === 0 ? `${animal.prefix}0` : `${animal.prefix}${i}`;
                    const specificImg = `https://masi4882.dothome.co.kr/${imgNum}.jpg?v=2026`;

                    deck.push({
                        id: i === 0 ? `${animal.id}_king` : `${animal.id}_${i}`,
                        animalId: animal.id, animalName: animal.name, name: animal.name,
                        isKing: i === 0, img: specificImg, repImg: animal.repImg 
                    });
                }
            });

            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            room.players.forEach(p => { p.hand = []; p.penalties = []; p.handCount = 0; });
            
            let dealIndex = 0;
            while (dealIndex < deck.length) {
                room.players.forEach(p => {
                    if (dealIndex < deck.length) { p.hand.push(deck[dealIndex]); p.handCount++; dealIndex++; }
                });
            }

            room.phase = 'GAME'; room.turnId = room.players[0].id; room.activeOffer = null;
            pokerIo.to(roomCode).emit('gameStarted', room);
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room) return;
            const attacker = room.players.find(p => p.id === socket.id);
            if (!attacker) return;

            attacker.hand = attacker.hand.filter(c => c.id !== card.id);
            attacker.handCount = attacker.hand.length; attacker.lastClaim = claim;
            room.phase = 'RESPONSE';
            room.activeOffer = { senderId: socket.id, attackerId: socket.id, receiverId: targetId, card, claim, seenIds: [socket.id] };

            pokerIo.to(roomCode).emit('onOffer', room);
        } catch(e) {}
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || !room.activeOffer) return;
            const player = room.players.find(pl => pl.id === socket.id);
            if (player) player.lastClaim = newClaim;

            room.activeOffer.senderId = socket.id; room.activeOffer.receiverId = nextTargetId;
            room.activeOffer.claim = newClaim; room.activeOffer.seenIds.push(socket.id);
            pokerIo.to(roomCode).emit('onOffer', room);
        } catch(e) {}
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || !room.activeOffer || !room.activeOffer.card) return;

            const offer = room.activeOffer; const actualCard = offer.card;
            let isTrue = false;
            if (offer.claim === '왕카드') isTrue = (actualCard.isKing === true);
            else isTrue = (actualCard.animalName === offer.claim);

            const guessCorrect = (isTrue === guessIsTrue);
            const loserId = guessCorrect ? offer.senderId : offer.receiverId;
            const winnerId = guessCorrect ? offer.receiverId : offer.senderId;

            let extraCard = null;
            if (actualCard.isKing || offer.claim === '왕카드') {
                const winner = room.players.find(p => p.id === winnerId);
                if (winner && winner.penalties.length > 0) {
                    const rIndex = Math.floor(Math.random() * winner.penalties.length);
                    extraCard = winner.penalties.splice(rIndex, 1)[0];
                }
            }

            const loser = room.players.find(p => p.id === loserId);
            if (loser) { loser.penalties.push(actualCard); if (extraCard) loser.penalties.push(extraCard); }

            room.phase = 'REVEAL';
            room.revealData = { winnerId, penaltyId: loserId, guessCorrect, actualCard, claim: offer.claim, extraCard };
            pokerIo.to(roomCode).emit('revealStart', room);

            setTimeout(() => {
                try {
                    if (!pokerRooms[roomCode]) return;
                    const currentRoom = pokerRooms[roomCode];
                    let isGameOver = false; let finalLoserId = null;
                    const penaltyLimit = currentRoom.players.length >= 7 ? 3 : 4;

                    currentRoom.players.forEach(p => {
                        if (p.hand.length === 0) { isGameOver = true; finalLoserId = p.id; }
                        const counts = {};
                        p.penalties.forEach(c => {
                            const baseId = c.id.replace('_king', '').replace(/_\d+$/, '');
                            counts[baseId] = (counts[baseId] || 0) + 1;
                            if (counts[baseId] >= penaltyLimit) { isGameOver = true; finalLoserId = p.id; }
                        });
                    });

                    if (isGameOver) {
                        currentRoom.phase = 'GAME_OVER'; currentRoom.loserId = finalLoserId;
                        pokerIo.to(roomCode).emit('roomUpdate', currentRoom);
                    } else {
                        currentRoom.phase = 'GAME'; currentRoom.turnId = loserId;
                        currentRoom.activeOffer = null; currentRoom.revealData = null;
                        pokerIo.to(roomCode).emit('roundResolved', currentRoom);
                    }
                } catch(e) {}
            }, 5500); 
        } catch(e) {}
    });

    socket.on('leaveRoom', (roomCode) => leavePokerRoom(socket, roomCode));
    socket.on('disconnect', () => { 
        for (const roomCode in pokerRooms) leavePokerRoom(socket, roomCode); 
    });
});

function leavePokerRoom(socket, roomCode) {
    try {
        const room = pokerRooms[roomCode];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id); socket.leave(roomCode);
            if (room.players.length === 0) delete pokerRooms[roomCode];
            else { room.players[0].ready = true; pokerIo.to(roomCode).emit('roomUpdate', room); }
        }
    } catch(e) {}
}


// ==========================================
// 🎯 [2] 플립 7 전용 (Namespace: /flip7) - 🔥 이 부분이 핵심입니다 🔥
// ==========================================
const flip7Io = io.of('/flip7');
const flip7Rooms = {};

flip7Io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!flip7Rooms[roomCode]) {
                flip7Rooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], timers: {} };
            }
            const room = flip7Rooms[roomCode];

            const existingName = room.players.find(p => p.name === userName && p.userId !== userId);
            if (existingName) {
                socket.emit('joinError', '동일한 닉네임이 존재합니다.');
                return;
            }

            const existingPlayer = room.players.find(p => p.userId === userId);
            if (existingPlayer) {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
                existingPlayer.isSpectator = (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER' && existingPlayer.isSpectator !== false);
                
                if (room.timers && room.timers[userId]) {
                    clearTimeout(room.timers[userId]); delete room.timers[userId];
                    flip7Io.to(roomCode).emit('playerReconnected', { id: socket.id, userId, name: userName });
                }
            } else {
                const isSpectator = room.phase !== 'LOBBY';
                room.players.push({ 
                    id: socket.id, userId, name: userName, isBot, 
                    ready: room.players.length === 0, score: 0, connected: true, isSpectator
                });
            }
            flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = flip7Rooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; flip7Io.to(roomCode).emit('roomUpdate', room); }
            }
        } catch(e) {}
    });

    socket.on('startGame', (roomCode) => {
        try {
            const room = flip7Rooms[roomCode];
            if (room && room.players.length > 0 && room.players[0].id === socket.id) {
                room.phase = 'GAME'; room.players.forEach(p => p.isSpectator = false); 
                flip7Io.to(roomCode).emit('gameStarted', room);
            }
        } catch(e) {}
    });

    socket.on('requestSyncFromOthers', (roomCode) => {
        try {
            const room = flip7Rooms[roomCode];
            if (room && room.players.length > 0) {
                const hostId = room.players.find(p => !p.isBot)?.id;
                if (hostId) flip7Io.to(hostId).emit('provideGameState');
            }
        } catch(e) {}
    });

    socket.on('sendGameStateSync', ({ roomCode, gameState }) => {
        try { socket.broadcast.to(roomCode).emit('updateGameStateSync', gameState); } catch(e) {}
    });

    socket.on('leaveRoom', (roomCode) => leaveFlip7Room(socket, roomCode));

    socket.on('disconnect', () => {
        try {
            for (const roomCode in flip7Rooms) {
                const room = flip7Rooms[roomCode];
                const player = room.players.find(p => p.id === socket.id);
                
                if (player) {
                    player.connected = false;
                    if ((room.phase === 'PLAYING' || room.phase === 'GAME') && !player.isSpectator) {
                        flip7Io.to(roomCode).emit('playerDisconnected', { id: player.id, userId: player.userId, name: player.name });
                        if (!room.timers) room.timers = {};
                        
                        room.timers[player.userId] = setTimeout(() => {
                            try {
                                room.players = room.players.filter(p => p.userId !== player.userId);
                                flip7Io.to(roomCode).emit('playerKicked', { userId: player.userId, name: player.name });
                                
                                if (room.players.filter(p => !p.isSpectator && !p.isBot).length === 0) delete flip7Rooms[roomCode];
                                else flip7Io.to(roomCode).emit('roomUpdate', room);
                                delete room.timers[player.userId];
                            } catch(err) {}
                        }, 60000); 
                    } else {
                        room.players = room.players.filter(p => p.id !== socket.id);
                        if (room.players.filter(p => !p.isSpectator && !p.isBot).length === 0) delete flip7Rooms[roomCode];
                        else { if(room.players[0]) room.players[0].ready = true; flip7Io.to(roomCode).emit('roomUpdate', room); }
                    }
                }
            }
        } catch(e) {}
    });
});

function leaveFlip7Room(socket, roomCode) {
    try {
        const room = flip7Rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player && room.timers && room.timers[player.userId]) {
                clearTimeout(room.timers[player.userId]); delete room.timers[player.userId];
            }
            room.players = room.players.filter(p => p.id !== socket.id); socket.leave(roomCode);
            
            if (room.players.filter(p => !p.isSpectator && !p.isBot).length === 0) delete flip7Rooms[roomCode];
            else { if(room.players[0]) room.players[0].ready = true; flip7Io.to(roomCode).emit('roomUpdate', room); }
        }
    } catch(e) {}
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`🚀 포커 & 플립7 서버 구동 완료. 포트 ${PORT}`); });
