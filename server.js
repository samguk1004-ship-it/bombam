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
    pingTimeout: 120000, 
    pingInterval: 25000,
    connectTimeout: 60000,
    upgradeTimeout: 30000,
    transports: ['websocket', 'polling'],
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
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], spectators: [], timers: {}, paused: false };
            const room = pokerRooms[roomCode];
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            
            if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                if (existingPlayer) {
                    existingPlayer.id = socket.id;
                    existingPlayer.isReconnecting = false;
                    existingPlayer.connected = true;
                }
            } else {
                if (!existingPlayer) {
                    room.players.push({
                        id: socket.id, userId, name: userName, isBot,
                        ready: room.players.length === 0, score: 0, hand: [], penalties: [], handCount: 0,
                        isReconnecting: false, connected: true
                    });
                } else {
                    existingPlayer.id = socket.id;
                    existingPlayer.connected = true;
                }
            }
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('leaveRoom', (roomCode) => leavePokerRoom(socket, roomCode));
    socket.on('disconnect', () => {});
});

function leavePokerRoom(socket, roomCode) {
    try {
        const room = pokerRooms[roomCode];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomCode);
            if (room.players.length === 0) delete pokerRooms[roomCode];
            else pokerIo.to(roomCode).emit('roomUpdate', room);
        }
    } catch(e) {}
}


// ==========================================
// 🎯 [2] 플립 7 전용 (Namespace: /flip7)
// ==========================================
const flip7Io = io.of('/flip7');
const flip7Rooms = {};

flip7Io.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!flip7Rooms[roomCode]) flip7Rooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], timers: {} };
            const room = flip7Rooms[roomCode];
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            if (existingPlayer) {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
            } else {
                room.players.push({ id: socket.id, userId, name: userName, isBot, ready: room.players.length === 0, score: 0, connected: true });
            }
            flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('leaveRoom', (roomCode) => leaveFlip7Room(socket, roomCode));
    socket.on('disconnect', () => {});
});

function leaveFlip7Room(socket, roomCode) {
    try {
        const room = flip7Rooms[roomCode];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomCode);
            if (room.players.length === 0) delete flip7Rooms[roomCode];
            else flip7Io.to(roomCode).emit('roomUpdate', room);
        }
    } catch(e) {}
}


// ==========================================
// 🗡️ [3] 쿠 전용 (Namespace: /coup)
// ==========================================
const coupIo = io.of('/coup');
const coupRooms = {};

function emitCoupUpdate(roomCode, room) {
    const safeRoom = {
        ...room,
        timer: room.timer ? { endTime: room.timer.endTime, duration: room.timer.duration } : null
    };
    coupIo.to(roomCode).emit('roomUpdate', safeRoom);
}

function startCoupTimer(room, roomCode, durationSec, callback) {
    if (room.timer && room.timer.timeoutId) clearTimeout(room.timer.timeoutId);
    room.timer = {
        endTime: Date.now() + durationSec * 1000,
        duration: durationSec,
        timeoutId: setTimeout(() => { callback(); }, durationSec * 1000)
    };
    emitCoupUpdate(roomCode, room);
}

function clearCoupTimer(room) {
    if (room.timer && room.timer.timeoutId) clearTimeout(room.timer.timeoutId);
    room.timer = null;
}

const createCoupDeck = (playerCount) => {
    const chars = ['외교관', '사령관', '공작', '자객', '귀부인'];
    const copies = playerCount >= 7 ? 4 : 3;
    let deck = [];
    chars.forEach(c => { 
        for(let i=0; i<copies; i++) deck.push(c);
    });
    return deck.sort(() => Math.random() - 0.5); 
};

function nextTurnCoup(room, roomCode) {
    clearCoupTimer(room);
    room.actionState = null; 
    
    do {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
    } while (room.players[room.turnIndex].isDead);
    room.turnId = room.players[room.turnIndex].id;

    startCoupTimer(room, roomCode, 60, () => {
        const currentRoom = coupRooms[roomCode];
        if (!currentRoom || currentRoom.phase !== 'GAME') return;
        
        const actor = currentRoom.players.find(p => p.id === currentRoom.turnId);
        if (actor && !actor.isDead) {
            actor.coins += 1;
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '시간 초과로 소득(+1) 처리되었습니다.' });
        }

        const alive = currentRoom.players.filter(p => !p.isDead);
        if (alive.length <= 1) {
            currentRoom.phase = 'GAME_OVER';
            currentRoom.winner = alive[0]?.name || '생존자 없음';
            emitCoupUpdate(roomCode, currentRoom);
        } else {
            nextTurnCoup(currentRoom, roomCode);
            emitCoupUpdate(currentRoom, currentRoom);
        }
    });
}

function setNextBlocker(room, roomCode) {
    const actorIdx = room.players.findIndex(p => p.id === room.actionState.actorId);
    let nextIdx = (actorIdx + 1) % room.players.length;
    
    let found = false;
    for (let i = 0; i < room.players.length - 1; i++) {
        const p = room.players[nextIdx];
        if (!p.isDead && !room.actionState.askedList.includes(p.id)) {
            if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'CAPTAIN') {
                if (p.id === room.actionState.targetId) {
                    room.actionState.currentPromptId = p.id;
                    found = true;
                }
            } else {
                room.actionState.currentPromptId = p.id;
                found = true;
            }
            break;
        }
        nextIdx = (nextIdx + 1) % room.players.length;
    }

    if (found) {
        startCoupTimer(room, roomCode, 30, () => processBlockResponse(room, roomCode, room.actionState.currentPromptId, false));
    } else {
        clearCoupTimer(room);
        const actor = room.players.find(p => p.id === room.actionState.actorId);
        const target = room.players.find(p => p.id === room.actionState.targetId);
        if (actor) {
            if (room.actionState.type === 'FOREIGN_AID') {
                actor.coins += 2;
            } else if (room.actionState.type === 'DUKE') {
                actor.coins += 3;
            } else if (room.actionState.type === 'ASSASSIN') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '암살에 성공했습니다.' });
                if (target && !target.isDead) {
                    room.actionState.phase = 'REVEAL_CARD';
                    room.actionState.revealerId = target.id;
                    room.actionState.type = 'ASSASSIN_DEATH';
                    emitCoupUpdate(roomCode, room);
                    return;
                }
            } else if (room.actionState.type === 'CAPTAIN') {
                const stealAmount = Math.min(2, target ? target.coins : 0);
                if (target) target.coins -= stealAmount;
                actor.coins += stealAmount;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `강탈에 성공하여 ${stealAmount}코인을 훔쳤습니다.` });
            }
        }
        room.actionState = null;
        nextTurnCoup(room, roomCode);
    }
}

function processBlockResponse(room, roomCode, playerId, block, blockRole) {
    clearCoupTimer(room);
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    const blocker = room.players.find(p => p.id === playerId);

    if (block) { 
        room.actionState.blockerId = playerId;
        room.actionState.blockRole = blockRole || '사령관';
        
        if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'CAPTAIN') {
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.revealerId = playerId;
            room.actionState.type = room.actionState.type === 'ASSASSIN' ? 'ASSASSIN_BLOCK_CHALLENGE' : 'CAPTAIN_BLOCK_CHALLENGE';

            emitCoupUpdate(roomCode, room);
            return;
        }

        room.actionState.phase = 'WAIT_CHALLENGE';
        startCoupTimer(room, roomCode, 30, () => processChallengeResponse(room, roomCode, room.actionState.actorId, false));
    } else { 
        room.actionState.askedList.push(playerId);
        coupIo.to(roomCode).emit('showOkEmote', playerId); 

        if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'CAPTAIN') {
            clearCoupTimer(room);
            const target = room.players.find(p => p.id === room.actionState.targetId);
            if (room.actionState.type === 'ASSASSIN') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor ? actor.name : '', actionText: '암살에 성공했습니다.' });
                if (target && !target.isDead) {
                    room.actionState.phase = 'REVEAL_CARD';
                    room.actionState.revealerId = target.id;
                    room.actionState.type = 'ASSASSIN_DEATH';
                    emitCoupUpdate(roomCode, room);
                    return;
                }
            } else {
                const stealAmount = Math.min(2, target ? target.coins : 0);
                if (target) target.coins -= stealAmount;
                actor.coins += stealAmount;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor ? actor.name : '', actionText: `강탈에 성공하여 ${stealAmount}코인을 훔쳤습니다.` });
                room.actionState = null;
                nextTurnCoup(room, roomCode);
                emitCoupUpdate(roomCode, room);
                return;
            }
        } else {
            setNextBlocker(room, roomCode);
        }
    }
    emitCoupUpdate(roomCode, room);
}

function processChallengeResponse(room, roomCode, playerId, challenge) {
    clearCoupTimer(room);
    if (challenge) { 
        room.actionState.phase = 'REVEAL_CARD';
        room.actionState.revealerId = (room.actionState.type === 'DUKE') ? room.actionState.actorId : room.actionState.blockerId;
        
        startCoupTimer(room, roomCode, 30, () => {
            const currentRoom = coupRooms[roomCode];
            if (!currentRoom || !currentRoom.actionState || currentRoom.actionState.phase !== 'REVEAL_CARD') return;
            const revealer = currentRoom.players.find(p => p.id === currentRoom.actionState.revealerId);
            if (revealer) {
                const idx = revealer.influence.findIndex(c => c.alive);
                if (idx !== -1) processRevealCard(currentRoom, roomCode, revealer.id, idx);
            }
        });
    } else {
        const actor = room.players.find(p => p.id === playerId);
        if(actor) {
            if (room.actionState.type === 'DUKE') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '징세를 실패했습니다.' });
            } else {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '원조에 실패했습니다.' });
            }
        }
        room.actionState = null;
        nextTurnCoup(room, roomCode);
    }
    emitCoupUpdate(roomCode, room);
}

function processRevealCard(room, roomCode, revealerId, cardIndex) {
    clearCoupTimer(room);
    const revealer = room.players.find(p => p.id === revealerId);
    if (!revealer) return;
    const card = revealer.influence[cardIndex];
    if (!card || !card.alive) return;

    const actionType = room.actionState ? room.actionState.type : '';
    const blockRole = room.actionState ? room.actionState.blockRole : '';
    
    let isSuccess = false;
    if (actionType === 'ASSASSIN_BLOCK_CHALLENGE') {
        isSuccess = (card.role === '귀부인');
    } else if (actionType === 'CAPTAIN_BLOCK_CHALLENGE') {
        isSuccess = (card.role === '사령관' || card.role === '외교관');
    } else if (actionType === 'DUKE' || actionType === 'FOREIGN_AID') {
        isSuccess = (card.role === '공작');
    }

    coupIo.to(roomCode).emit('blockRevealAnimation', {
        revealerId: revealer.id,
        cardIndex: cardIndex,
        revealedRole: card.role,
        isSuccess: isSuccess
    });

    setTimeout(() => {
        const currentRoom = coupRooms[roomCode];
        if (!currentRoom) return;
        const currentRevealer = currentRoom.players.find(p => p.id === revealerId);
        if (!currentRevealer) return;
        const currentCard = currentRevealer.influence[cardIndex];
        const curActionType = currentRoom.actionState ? currentRoom.actionState.type : '';

        if (curActionType === 'COUP' || curActionType === 'ASSASSIN_DEATH' || curActionType === 'ASSASSIN_ATTACKER_DEATH') {
            currentCard.alive = false;
            if (!currentRevealer.influence.some(c => c.alive)) currentRevealer.isDead = true;

            const alivePlayers = currentRoom.players.filter(p => !p.isDead);
            if (alivePlayers.length <= 1) {
                currentRoom.phase = 'GAME_OVER';
                currentRoom.winner = alivePlayers[0]?.name || '생존자 없음';
                emitCoupUpdate(roomCode, currentRoom);
                return;
            } else {
                currentRoom.actionState = null;
                nextTurnCoup(currentRoom, roomCode);
                emitCoupUpdate(currentRoom, currentRoom);
                return;
            }
        } else if (curActionType === 'ASSASSIN_BLOCK_CHALLENGE' || curActionType === 'CAPTAIN_BLOCK_CHALLENGE') {
            const actor = currentRoom.players.find(p => p.id === currentRoom.actionState.actorId);

            if (isSuccess) {
                const matchedRole = currentCard.role;
                currentRoom.deck.push(matchedRole);
                currentRoom.deck.sort(() => Math.random() - 0.5);
                currentCard.role = currentRoom.deck.pop();
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: '', actionText: curActionType === 'CAPTAIN_BLOCK_CHALLENGE' ? '강탈에 실패했습니다.' : '암살에 실패했습니다.' });
                
                if (curActionType === 'ASSASSIN_BLOCK_CHALLENGE') {
                    setTimeout(() => {
                        if (!currentRoom) return;
                        currentRoom.actionState.phase = 'REVEAL_CARD';
                        currentRoom.actionState.revealerId = currentRoom.actionState.actorId; 
                        currentRoom.actionState.type = 'ASSASSIN_ATTACKER_DEATH';
                        emitCoupUpdate(currentRoom, currentRoom);
                    }, 2000);
                    return;
                } else {
                    currentRoom.actionState = null;
                    nextTurnCoup(currentRoom, currentRoom);
                    emitCoupUpdate(currentRoom, currentRoom);
                    return;
                }
            } else {
                currentCard.alive = false;
                if (!currentRevealer.influence.some(c => c.alive)) currentRevealer.isDead = true;
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor ? actor.name : '', actionText: curActionType === 'CAPTAIN_BLOCK_CHALLENGE' ? '강탈 방어 실패! 강탈에 성공했습니다.' : '암살 방어 실패! 암살에 성공했습니다.' });
                
                if (curActionType === 'CAPTAIN_BLOCK_CHALLENGE') {
                    const target = currentRoom.players.find(p => p.id === currentRoom.actionState.targetId);
                    const stealAmount = Math.min(2, target ? target.coins : 0);
                    if (target) target.coins -= stealAmount;
                    actor.coins += stealAmount;
                }
            }
        }

        const alivePlayers = currentRoom.players.filter(p => !p.isDead);
        if (alivePlayers.length <= 1) {
            currentRoom.phase = 'GAME_OVER';
            currentRoom.winner = alivePlayers[0]?.name || '생존자 없음';
            emitCoupUpdate(roomCode, currentRoom);
        } else {
            currentRoom.actionState = null;
            nextTurnCoup(currentRoom, roomCode);
            emitCoupUpdate(currentRoom, currentRoom);
        }
    }, 3000);
}


coupIo.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!coupRooms[roomCode]) {
                coupRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], spectators: [], turnIndex: 0, deck: [], actionState: null, timer: null };
            }
            const room = coupRooms[roomCode];
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || p.name === userName);
            
            if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                if (existingPlayer) {
                    existingPlayer.id = socket.id;
                    existingPlayer.connected = true;
                }
            } else {
                if (existingPlayer) {
                    existingPlayer.id = socket.id;
                    existingPlayer.connected = true;
                } else {
                    room.players.push({
                        id: socket.id, name: userName, userId, isBot, ready: room.players.length === 0,
                        coins: 2, influence: [], isDead: false, connected: true
                    });
                }
            }
            emitCoupUpdate(roomCode, room);
        } catch(e) {}
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = coupRooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; emitCoupUpdate(roomCode, room); }
            }
        } catch(e) {}
    });

    socket.on('startGame', (roomCode) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || room.players.length === 0) return;
            const allReady = room.players.length === 1 || room.players.slice(1).every(p => p.ready);
            if (!allReady) return; 
            
            room.phase = 'GAME';
            room.actionState = null;
            room.spectators = []; 
            room.deck = createCoupDeck(room.players.length);
            
            room.players.forEach(p => {
                p.coins = 2;
                p.isDead = false;
                p.influence = [
                    { role: room.deck.pop(), alive: true },
                    { role: room.deck.pop(), alive: true }
                ];
            });
            
            room.turnIndex = Math.floor(Math.random() * room.players.length);
            room.turnId = room.players[room.turnIndex].id;
            
            coupIo.to(roomCode).emit('gameStarted', room);
            nextTurnCoup(room, roomCode);
        } catch(e) {}
    });

    socket.on('submitAction', ({ roomCode, action, targetId }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room) return;

            const actor = room.players.find(p => p.id === socket.id);
            const target = room.players.find(p => p.id === targetId);

            if (socket.id !== room.turnId || actor.isDead || room.actionState) return;
            if (actor.coins >= 10 && action !== 'COUP') return;

            clearCoupTimer(room);

            if (action === 'FOREIGN_AID') {
                room.actionState = { phase: 'ANNOUNCING' }; 
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '원조를 사용했습니다.' });
                setTimeout(() => {
                    const currentRoom = coupRooms[roomCode];
                    if(!currentRoom) return;
                    currentRoom.actionState = { type: 'FOREIGN_AID', actorId: actor.id, askedList: [], phase: 'WAIT_BLOCK' };
                    setNextBlocker(currentRoom, roomCode);
                    emitCoupUpdate(roomCode, currentRoom);
                }, 1500);
                return;
            } else if (action === 'DUKE') {
                room.actionState = { phase: 'ANNOUNCING' }; 
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '징세를 사용했습니다.' });
                setTimeout(() => {
                    const currentRoom = coupRooms[roomCode];
                    if(!currentRoom) return;
                    currentRoom.actionState = { type: 'DUKE', actorId: actor.id, askedList: [], phase: 'WAIT_BLOCK' };
                    setNextBlocker(currentRoom, roomCode);
                    emitCoupUpdate(currentRoom, roomCode);
                }, 1500);
                return;
            } else if (action === 'ASSASSIN' && target) {
                actor.coins -= 3;
                room.actionState = { phase: 'ANNOUNCING' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '암살을 시도합니다.' });
                setTimeout(() => {
                    const currentRoom = coupRooms[roomCode];
                    if (!currentRoom) return;
                    currentRoom.actionState = { type: 'ASSASSIN', actorId: actor.id, targetId: target.id, askedList: [], phase: 'WAIT_BLOCK' };
                    setNextBlocker(currentRoom, currentRoom);
                    emitCoupUpdate(currentRoom, currentRoom);
                }, 1500);
                return;
            } else if (action === 'CAPTAIN' && target) {
                room.actionState = { phase: 'ANNOUNCING' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${target.name}님을 강탈합니다.` });
                setTimeout(() => {
                    const currentRoom = coupRooms[roomCode];
                    if (!currentRoom) return;
                    currentRoom.actionState = { type: 'CAPTAIN', actorId: actor.id, targetId: target.id, askedList: [], phase: 'WAIT_BLOCK' };
                    setNextBlocker(currentRoom, currentRoom);
                    emitCoupUpdate(currentRoom, currentRoom);
                }, 1500);
                return;
            }

            if (action === 'INCOME') actor.coins += 1;
            else if (action === 'COUP' && target) {
                actor.coins -= 7;
                room.actionState = { type: 'COUP', actorId: actor.id, revealerId: target.id, phase: 'REVEAL_CARD' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${target.name}님에게 쿠를 사용했습니다! 버릴 카드를 선택하세요.` });
                startCoupTimer(room, roomCode, 30, () => {
                    const currentRoom = coupRooms[roomCode];
                    if (!currentRoom || !currentRoom.actionState || currentRoom.actionState.phase !== 'REVEAL_CARD') return;
                    const revealer = currentRoom.players.find(p => p.id === currentRoom.actionState.revealerId);
                    if (revealer) {
                        const idx = revealer.influence.findIndex(c => c.alive);
                        if (idx !== -1) processRevealCard(currentRoom, roomCode, revealer.id, idx);
                    }
                });
                emitCoupUpdate(roomCode, room);
                return;
            } else if (action === 'AMBASSADOR') {
                const aliveCards = actor.influence.filter(c => c.alive).map(c => c.role);
                const drawn1 = room.deck.pop();
                const drawn2 = room.deck.pop();
                const allFour = [...aliveCards, drawn1, drawn2];

                room.tempAmbassadorCards = { playerId: actor.id, drawnCards: allFour };
                coupIo.to(socket.id).emit('startAmbassadorAnim', { actorId: actor.id, drawnCards: allFour });
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '카드를 교환합니다.' });
                return;
            }

            const alivePlayers = room.players.filter(p => !p.isDead);
            if (alivePlayers.length <= 1) {
                room.phase = 'GAME_OVER'; 
                room.winner = alivePlayers[0]?.name || '생존자 없음';
                emitCoupUpdate(roomCode, room);
            } else {
                nextTurnCoup(room, roomCode);
            }
        } catch(e) {}
    });

    socket.on('ambassadorChosen', ({ roomCode, keepIndices, returnIndices }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.tempAmbassadorCards || room.tempAmbassadorCards.playerId !== socket.id) return;

            const actor = room.players.find(p => p.id === socket.id);
            if (!actor) return;

            const { drawnCards } = room.tempAmbassadorCards;
            const keptRoles = keepIndices.map(i => drawnCards[i]);
            const returnedRoles = returnIndices.map(i => drawnCards[i]);

            returnedRoles.forEach(role => room.deck.push(role));
            room.deck.sort(() => Math.random() - 0.5);

            let aliveIdx = 0;
            actor.influence.forEach(c => {
                if (c.alive && aliveIdx < keptRoles.length) c.role = keptRoles[aliveIdx++];
            });

            room.tempAmbassadorCards = null;

            const alivePlayers = room.players.filter(p => !p.isDead);
            if (alivePlayers.length <= 1) {
                room.phase = 'GAME_OVER';
                room.winner = alivePlayers[0]?.name || '생존자 없음';
                emitCoupUpdate(roomCode, room);
            } else {
                nextTurnCoup(room, roomCode);
            }
        } catch(e) {}
    });

    socket.on('blockResponse', ({ roomCode, block, blockRole }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_BLOCK' || room.actionState.currentPromptId !== socket.id) return;
            
            if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'CAPTAIN') {
                clearCoupTimer(room);
                if (block) {
                    room.actionState.blockerId = socket.id;
                    room.actionState.blockRole = blockRole || (room.actionState.type === 'ASSASSIN' ? '귀부인' : '사령관');
                    room.actionState.type = room.actionState.type === 'ASSASSIN' ? 'ASSASSIN_BLOCK_CHALLENGE' : 'CAPTAIN_BLOCK_CHALLENGE';
                    room.actionState.phase = 'REVEAL_CARD';
                    room.actionState.revealerId = socket.id;
                    
                    emitCoupUpdate(roomCode, room);
                } else {
                    room.actionState.askedList.push(socket.id);
                    coupIo.to(roomCode).emit('showOkEmote', socket.id);
                    setNextBlocker(room, roomCode);
                }
                return;
            }

            processBlockResponse(room, roomCode, socket.id, block, blockRole);
        } catch(e){}
    });

    socket.on('challengeResponse', ({ roomCode, challenge }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_CHALLENGE' || room.actionState.actorId !== socket.id) return;
            processChallengeResponse(room, roomCode, socket.id, challenge);
        } catch(e){}
    });

    socket.on('revealCard', ({ roomCode, cardIndex }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'REVEAL_CARD' || room.actionState.revealerId !== socket.id) return;
            processRevealCard(room, roomCode, socket.id, cardIndex);
        } catch(e){}
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { 
    console.log(`🚀 포커, 플립7 & COUP 서버 구동 완료. 포트 ${PORT}`); 
});
