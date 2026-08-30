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
            <p>포커, 플립7, 쿠(COUP) 모두 접속 가능한 상태입니다.</p>
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

function checkGameOver(currentRoom, roomCode) {
    try {
        if (!pokerRooms[roomCode]) return;
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
            currentRoom.phase = 'GAME'; currentRoom.turnId = currentRoom.revealData.penaltyId;
            currentRoom.activeOffer = null; currentRoom.revealData = null;
            pokerIo.to(roomCode).emit('roundResolved', currentRoom);
        }
    } catch(e) {}
}

pokerIo.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], spectators: [], timers: {}, paused: false };
            const room = pokerRooms[roomCode];
            
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            
            if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                if (existingPlayer) {
                    const oldId = existingPlayer.id;
                    const newId = socket.id;
                    
                    existingPlayer.id = newId;
                    existingPlayer.isReconnecting = false;
                    existingPlayer.connected = true;

                    if (room.turnId === oldId) room.turnId = newId;
                    if (room.activeOffer) {
                        if (room.activeOffer.senderId === oldId) room.activeOffer.senderId = newId;
                        if (room.activeOffer.attackerId === oldId) room.activeOffer.attackerId = newId;
                        if (room.activeOffer.receiverId === oldId) room.activeOffer.receiverId = newId;
                        if (room.activeOffer.seenIds) {
                            room.activeOffer.seenIds = room.activeOffer.seenIds.map(id => id === oldId ? newId : id);
                        }
                    }
                    if (room.revealData) {
                        if (room.revealData.winnerId === oldId) room.revealData.winnerId = newId;
                        if (room.revealData.penaltyId === oldId) room.revealData.penaltyId = newId;
                    }

                    if (room.timers && room.timers[existingPlayer.userId]) {
                        clearTimeout(room.timers[existingPlayer.userId]);
                        delete room.timers[existingPlayer.userId];
                    }

                    const stillReconnecting = room.players.some(p => p.isReconnecting);
                    if (!stillReconnecting) {
                        room.paused = false;
                    }
                } else {
                    if (!room.spectators) room.spectators = [];
                    if (!room.spectators.find(s => s.userId === userId)) {
                        room.spectators.push({ id: socket.id, userId, name: userName });
                    }
                }
            } 
            else {
                if (!existingPlayer) {
                    room.players.push({
                        id: socket.id, userId, name: userName, isBot,
                        ready: room.players.length === 0, score: 0, hand: [], penalties: [], handCount: 0,
                        isReconnecting: false, connected: true
                    });
                } else {
                    existingPlayer.id = socket.id;
                    existingPlayer.connected = true;
                    existingPlayer.isReconnecting = false;
                }
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

            room.phase = 'GAME'; room.turnId = room.players[0].id; room.activeOffer = null; room.paused = false;
            pokerIo.to(roomCode).emit('gameStarted', room);
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || room.paused) return;
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
            if (!room || !room.activeOffer || room.paused) return;
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
            if (!room || !room.activeOffer || !room.activeOffer.card || room.paused) return;

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
                checkGameOver(room, roomCode);
            }, 5500); 
        } catch(e) {}
    });

    socket.on('forceTurnSkip', ({ roomCode, targetId }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || room.paused) return;
            const targetPlayer = room.players.find(p => p.id === targetId);
            if (!targetPlayer) return;

            if (room.isProcessingSkip) return;
            room.isProcessingSkip = true;
            setTimeout(() => { room.isProcessingSkip = false; }, 1000);

            if (room.phase === 'GAME' && room.turnId === targetId && !room.activeOffer) {
                if (targetPlayer.hand.length > 0) {
                    const card = targetPlayer.hand[Math.floor(Math.random() * targetPlayer.hand.length)];
                    const possibleTargets = room.players.filter(p => p.id !== targetId && p.connected !== false);
                    if (possibleTargets.length > 0) {
                        const rec = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
                        targetPlayer.hand = targetPlayer.hand.filter(c => c.id !== card.id);
                        targetPlayer.handCount = targetPlayer.hand.length;
                        const claim = BASE_ANIMALS[Math.floor(Math.random() * BASE_ANIMALS.length)].name;
                        targetPlayer.lastClaim = claim;
                        room.phase = 'RESPONSE';
                        room.activeOffer = { senderId: targetId, attackerId: targetId, receiverId: rec.id, card, claim, seenIds: [targetId] };
                        pokerIo.to(roomCode).emit('onOffer', room);
                    }
                }
            } else if (room.phase === 'RESPONSE' && room.activeOffer && room.activeOffer.receiverId === targetId) {
                const guessIsTrue = Math.random() < 0.5;
                const offer = room.activeOffer; 
                const actualCard = offer.card;
                
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

                setTimeout(() => { checkGameOver(room, roomCode); }, 5500);
            }
        } catch(e) {}
    });

    socket.on('leaveRoom', (roomCode) => leavePokerRoom(socket, roomCode));
    
    socket.on('disconnect', () => { 
        for (const roomCode in pokerRooms) {
            try {
                const room = pokerRooms[roomCode];
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.connected = false;
                    if (room.phase === 'GAME' || room.phase === 'RESPONSE' || room.phase === 'REVEAL') {
                        player.isReconnecting = true;
                        room.paused = true; 
                        
                        if (!room.timers) room.timers = {};
                        
                        room.timers[player.userId] = setTimeout(() => {
                            try {
                                if (!pokerRooms[roomCode]) return;
                                const r = pokerRooms[roomCode];
                                
                                const isTheirTurn = r.phase === 'GAME' && r.turnId === player.id;
                                const isTheirResponse = r.phase === 'RESPONSE' && r.activeOffer && r.activeOffer.receiverId === player.id;

                                r.players = r.players.filter(p => p.userId !== player.userId);
                                
                                const stillReconnecting = r.players.some(p => p.isReconnecting);
                                if (!stillReconnecting) {
                                    r.paused = false;
                                }

                                if (r.players.filter(p => !p.isBot).length === 0) {
                                    delete pokerRooms[roomCode];
                                } else {
                                    if (r.players.length < 2) {
                                        r.phase = 'GAME_OVER';
                                        r.loserId = player.id; 
                                    } else {
                                        if (isTheirTurn || isTheirResponse) {
                                            r.phase = 'GAME';
                                            r.activeOffer = null;
                                            const remainingPlayers = r.players;
                                            const randomPlayer = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
                                            r.turnId = randomPlayer.id; 
                                        }
                                    }
                                    pokerIo.to(roomCode).emit('roomUpdate', r);
                                }
                                delete r.timers[player.userId];
                            } catch(err) {}
                        }, 30000); 
                        
                        pokerIo.to(roomCode).emit('roomUpdate', room);
                    } else {
                        room.players = room.players.filter(p => p.id !== socket.id);
                        if (room.players.filter(p => !p.isBot).length === 0) delete pokerRooms[roomCode];
                        else pokerIo.to(roomCode).emit('roomUpdate', room);
                    }
                } else {
                    if (room.spectators) room.spectators = room.spectators.filter(s => s.id !== socket.id);
                }
            } catch(e) {}
        }
    });
});

function leavePokerRoom(socket, roomCode) {
    try {
        const room = pokerRooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player && room.timers && room.timers[player.userId]) {
                clearTimeout(room.timers[player.userId]);
                delete room.timers[player.userId];
            }
            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomCode);
            
            if (room.players.filter(p => !p.isBot).length === 0) {
                delete pokerRooms[roomCode];
            } else {
                if (room.phase === 'GAME' || room.phase === 'RESPONSE' || room.phase === 'REVEAL') {
                    if (room.players.length < 2) {
                        room.phase = 'GAME_OVER';
                    }
                } else {
                    if (room.players[0]) room.players[0].ready = true;
                }
                pokerIo.to(roomCode).emit('roomUpdate', room);
            }
        }
    } catch(e) {}
}


// ==========================================
// 🎯 [2] 플립 7 전용 (Namespace: /flip7)
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

            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
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


// ==========================================
// 🗡️ [3] 쿠 전용 (Namespace: /coup)
// ==========================================
const coupIo = io.of('/coup');
const coupRooms = {};

// 쿠 기본 덱 생성 (각 3장씩 총 15장)
const createCoupDeck = () => {
    const chars = ['공작', '자객', '사령관', '외교관', '귀부인'];
    let deck = [];
    chars.forEach(c => { deck.push(c, c, c); });
    return deck.sort(() => Math.random() - 0.5); // 카드 셔플
};

coupIo.on('connection', (socket) => {
    // 1. 방 입장
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!coupRooms[roomCode]) {
                coupRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], turnIndex: 0, deck: [] };
            }
            const room = coupRooms[roomCode];
            
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || p.name === userName);
            
            if (existingPlayer) {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
            } else {
                room.players.push({
                    id: socket.id, name: userName, userId, isBot, ready: room.players.length === 0,
                    coins: 2, influence: [], isDead: false, connected: true
                });
            }
            coupIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });

    // 2. 준비 상태 토글
    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = coupRooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; coupIo.to(roomCode).emit('roomUpdate', room); }
            }
        } catch(e) {}
    });

    // 3. 게임 시작 [수정: 랜덤 턴 부여]
    socket.on('startGame', (roomCode) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || room.players.length === 0) return;
            
            room.phase = 'GAME';
            room.deck = createCoupDeck();
            
            // 플레이어 초기화 (코인 2개, 카드 2장씩 배분)
            room.players.forEach(p => {
                p.coins = 2;
                p.isDead = false;
                p.influence = [
                    { role: room.deck.pop(), alive: true },
                    { role: room.deck.pop(), alive: true }
                ];
            });
            
            // [랜덤 시작 적용] 방장(0번 인덱스) 우선이 아닌 무작위 인덱스 추첨
            room.turnIndex = Math.floor(Math.random() * room.players.length);
            room.turnId = room.players[room.turnIndex].id;
            
            coupIo.to(roomCode).emit('gameStarted', room);
            coupIo.to(roomCode).emit('roomUpdate', room); // 추가: 턴 업데이트 동기화
        } catch(e) {}
    });

    // 4. 액션 처리 
    socket.on('submitAction', ({ roomCode, action, targetId }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room) return;

            const actor = room.players.find(p => p.id === socket.id);
            const target = room.players.find(p => p.id === targetId);

            if (socket.id !== room.turnId || actor.isDead) return;

            // 액션별 로직
            if (action === 'INCOME') {
                actor.coins += 1;
            } else if (action === 'FOREIGN_AID') {
                actor.coins += 2;
            } else if (action === 'DUKE') {
                actor.coins += 3;
            } else if (action === 'COUP' && target) {
                actor.coins -= 7;
                killCoupInfluence(target);
            } else if (action === 'ASSASSIN' && target) {
                actor.coins -= 3;
                killCoupInfluence(target);
            } else if (action === 'CAPTAIN' && target) {
                const stealAmount = Math.min(2, target.coins);
                target.coins -= stealAmount;
                actor.coins += stealAmount;
            } else if (action === 'AMBASSADOR') {
                // 외교관: 간소화된 로직 적용 (살아있는 카드를 다시 덱에 넣고 섞은 후 재뽑기)
                actor.influence.forEach(c => {
                    if (c.alive) room.deck.push(c.role);
                });
                room.deck.sort(() => Math.random() - 0.5);
                actor.influence = actor.influence.map(c => {
                    if (c.alive) return { role: room.deck.pop(), alive: true };
                    return c;
                });
            }

            // 승리 조건 체크 및 턴 넘기기
            const alivePlayers = room.players.filter(p => !p.isDead);
            if (alivePlayers.length === 1) {
                room.phase = 'GAME_OVER';
                room.winner = alivePlayers[0].name;
            } else {
                // [수정: 시계 방향 턴 진행] 배열의 끝에 도달하면 처음(0)으로 돌아감
                do {
                    room.turnIndex = (room.turnIndex + 1) % room.players.length;
                } while (room.players[room.turnIndex].isDead);
                room.turnId = room.players[room.turnIndex].id;
            }

            coupIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });

    socket.on('leaveRoom', (roomCode) => leaveCoupRoom(socket, roomCode));
    
    socket.on('disconnect', () => {
        try { leaveCoupRoom(socket, null); } catch(e) {}
    });
});

function killCoupInfluence(target) {
    const aliveCard = target.influence.find(c => c.alive);
    if (aliveCard) aliveCard.alive = false;
    if (!target.influence.some(c => c.alive)) target.isDead = true;
}

function leaveCoupRoom(socket, specificRoomCode) {
    const checkRooms = specificRoomCode ? [specificRoomCode] : Object.keys(coupRooms);
    checkRooms.forEach(roomCode => {
        const room = coupRooms[roomCode];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (specificRoomCode) socket.leave(roomCode);
            
            if (room.players.filter(p => !p.isBot).length === 0) {
                delete coupRooms[roomCode];
            } else {
                if (room.phase === 'GAME' && room.players.filter(p => !p.isDead).length < 2) {
                    room.phase = 'GAME_OVER';
                    room.winner = room.players.find(p => !p.isDead)?.name || '생존자 없음';
                } else if (room.phase === 'GAME' && room.turnId === socket.id) {
                    do {
                        room.turnIndex = (room.turnIndex + 1) % room.players.length;
                    } while (room.players[room.turnIndex].isDead);
                    room.turnId = room.players[room.turnIndex].id;
                } else if (room.phase === 'LOBBY' && room.players[0]) {
                    room.players[0].ready = true;
                }
                coupIo.to(roomCode).emit('roomUpdate', room);
            }
        }
    });
}


const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { 
    console.log(`🚀 포커, 플립7 & COUP 서버 구동 완료. 포트 ${PORT}`); 
});
