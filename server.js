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
            <p>포커, 플립7, 쿠(COUP), 사보타지 모두 접속 가능한 상태입니다.</p>
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

function getJosa(word, josa) {
    if (!word) return '';
    const lastChar = word.charCodeAt(word.length - 1);
    if (lastChar < 0xac00 || lastChar > 0xd7a3) return josa.split('/')[0] || josa;
    const jong = (lastChar - 0xac00) % 28;
    const hasJong = jong > 0;
    if (josa === '이/가' || josa === '이' || josa === '가') return hasJong ? '이' : '가';
    if (josa === '을/를' || josa === '을' || josa === '를') return hasJong ? '을' : '를';
    if (josa === '은/는' || josa === '은' || josa === '는') return hasJong ? '은' : '는';
    if (josa === '으로/로' || josa === '으로' || josa === '로') return (hasJong && jong !== 8) ? '으로' : '로';
    if (josa === '과/와' || josa === '과' || josa === '와') return hasJong ? '과' : '와';
    return josa;
}

const TimerHelper = {
    add: (room, callback, delay) => {
        if (!room.timeouts) room.timeouts = new Set();
        const timer = setTimeout(() => {
            if (room.timeouts) room.timeouts.delete(timer);
            callback();
        }, delay);
        room.timeouts.add(timer);
        return timer;
    },
    clearAll: (room) => {
        if (room.timer && room.timer.timeoutId) {
            clearTimeout(room.timer.timeoutId);
            room.timer.timeoutId = null;
        }
        if (room.timeouts) {
            room.timeouts.forEach(t => clearTimeout(t));
            room.timeouts.clear();
        }
    }
};

function destroyRoom(roomsObj, disconnectTimers, roomCode, ioNamespace, message) {
    const room = roomsObj[roomCode];
    if (!room) return;
    
    TimerHelper.clearAll(room);

    if (disconnectTimers) {
        Object.keys(disconnectTimers).forEach(key => {
            if (key.startsWith(`${roomCode}_`)) {
                clearTimeout(disconnectTimers[key]);
                delete disconnectTimers[key];
            }
        });
    }

    if (message) ioNamespace.to(roomCode).emit('roomDestroyed', { message });
    delete roomsObj[roomCode];
}

// ==========================================
// [1] 바퀴벌레 포커
// ==========================================
const pokerIo = io.of('/poker');
const pokerRooms = {};
const POKER_ANIMALS = [
    { id: 'spider', name: '거미', img: 'https://masi4882.dothome.co.kr/06.jpg?v=2026', prefix: '0' },
    { id: 'stinkbug', name: '노린재', img: 'https://masi4882.dothome.co.kr/12.jpg?v=2026', prefix: '1' },
    { id: 'toad', name: '두꺼비', img: 'https://masi4882.dothome.co.kr/24.jpg?v=2026', prefix: '2' },
    { id: 'cockroach', name: '바퀴벌레', img: 'https://masi4882.dothome.co.kr/32.jpg?v=2026', prefix: '3' },
    { id: 'scorpion', name: '전갈', img: 'https://masi4882.dothome.co.kr/43.jpg?v=2026', prefix: '4' },
    { id: 'bat', name: '박쥐', img: 'https://masi4882.dothome.co.kr/55.jpg?v=2026', prefix: '5' },
    { id: 'rat', name: '쥐', img: 'https://masi4882.dothome.co.kr/64.jpg?v=2026', prefix: '6' },
    { id: 'fly', name: '파리', img: 'https://masi4882.dothome.co.kr/74.jpg?v=2026', prefix: '7' }
];
const POKER_EXT_ANIMALS = [ ...POKER_ANIMALS,
    { id: 'mosquito', name: '모기', img: 'https://masi4882.dothome.co.kr/86.jpg?v=2026', prefix: '8' },
    { id: 'snake', name: '뱀', img: 'https://masi4882.dothome.co.kr/92.jpg?v=2026', prefix: '9' }
];

function createPokerDeck(playerCount) {
    const animals = playerCount >= 7 ? POKER_EXT_ANIMALS : POKER_ANIMALS;
    let deck = [];
    animals.forEach(a => {
        for (let i = 0; i < 7; i++) {
            deck.push({ id: `${a.id}_${i}`, animalId: a.id, animalName: a.name, name: a.name, img: a.img, isKing: false });
        }
        deck.push({ id: `${a.id}_king`, animalId: a.id, animalName: a.name, name: `왕 ${a.name}`, img: `https://masi4882.dothome.co.kr/${a.prefix}0.jpg?v=2026`, isKing: true });
    });
    return deck.sort(() => Math.random() - 0.5);
}

pokerIo.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], spectators: [], timeouts: new Set(), paused: false };
            const room = pokerRooms[roomCode];
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            
            if (!existingPlayer) {
                if (room.phase !== 'LOBBY') {
                    room.players.push({ id: socket.id, userId, name: userName, isBot, isSpectator: true, connected: true });
                } else {
                    room.players.push({ id: socket.id, userId, name: userName, isBot, ready: room.players.length === 0, score: 0, hand: [], penalties: [], handCount: 0, connected: true, isReconnecting: false, isSpectator: false });
                }
            } else {
                const oldId = existingPlayer.id;
                existingPlayer.id = socket.id; 
                existingPlayer.connected = true; 
                existingPlayer.isReconnecting = false;
                
                if (room.turnId === oldId) room.turnId = socket.id;
                if (room.activeOffer) {
                    if (room.activeOffer.attackerId === oldId) room.activeOffer.attackerId = socket.id;
                    if (room.activeOffer.senderId === oldId) room.activeOffer.senderId = socket.id;
                    if (room.activeOffer.targetId === oldId) room.activeOffer.targetId = socket.id;
                    if (room.activeOffer.receiverId === oldId) room.activeOffer.receiverId = socket.id;
                    if (room.activeOffer.seenIds) room.activeOffer.seenIds = room.activeOffer.seenIds.map(id => id === oldId ? socket.id : id);
                }
                if (room.revealData) {
                    if (room.revealData.winnerId === oldId) room.revealData.winnerId = socket.id;
                    if (room.revealData.penaltyId === oldId) room.revealData.penaltyId = socket.id;
                }
                room.paused = room.players.some(p => !p.connected && !p.isSpectator);
            }
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('playerReady', ({ roomCode, ready }) => {
        try { const room = pokerRooms[roomCode]; if (room) { const player = room.players.find(p => p.id === socket.id); if (player) { player.ready = ready; pokerIo.to(roomCode).emit('roomUpdate', room); } } } catch(e) {}
    });
    socket.on('startGame', (roomCode) => {
        try {
            const room = pokerRooms[roomCode]; if (!room) return;
            const activePlayers = room.players.filter(p => !p.isSpectator);
            if (activePlayers.length < 1) return;
            
            room.phase = 'GAME'; room.activeOffer = null; room.revealData = null;
            const deck = createPokerDeck(activePlayers.length);
            let pIdx = 0; 
            while(deck.length > 0) { 
                activePlayers[pIdx].hand.push(deck.pop()); 
                pIdx = (pIdx + 1) % activePlayers.length; 
            }
            activePlayers.forEach(p => { p.handCount = p.hand.length; p.penalties = []; p.lastClaim = null; });
            room.turnId = activePlayers[Math.floor(Math.random() * activePlayers.length)].id;
            pokerIo.to(roomCode).emit('gameStarted', room);
        } catch (e) {}
    });
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        try {
            const room = pokerRooms[roomCode]; if (!room) return;
            const player = room.players.find(p => p.id === socket.id); if (!player || room.turnId !== socket.id) return;
            player.hand = player.hand.filter(c => c.id !== card.id); player.handCount = player.hand.length; player.lastClaim = claim;
            room.activeOffer = { attackerId: socket.id, senderId: socket.id, targetId: targetId, receiverId: targetId, card: card, claim: claim, seenIds: [socket.id] };
            room.phase = 'RESPONSE'; pokerIo.to(roomCode).emit('onOffer', room);
        } catch (e) {}
    });
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        try {
            const room = pokerRooms[roomCode]; if (!room || !room.activeOffer) return;
            const player = room.players.find(p => p.id === socket.id); if(player) player.lastClaim = newClaim;
            room.activeOffer.seenIds.push(socket.id); room.activeOffer.senderId = socket.id; room.activeOffer.targetId = nextTargetId; room.activeOffer.receiverId = nextTargetId; room.activeOffer.claim = newClaim;
            pokerIo.to(roomCode).emit('onOffer', room);
        } catch (e) {}
    });
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        try {
            const room = pokerRooms[roomCode]; if (!room || !room.activeOffer || room.activeOffer.receiverId !== socket.id) return;
            const offer = room.activeOffer; const card = offer.card; const claim = offer.claim;
            let actualClaimCorrect = false;
            if (claim === '왕카드') actualClaimCorrect = card.isKing; else actualClaimCorrect = (card.animalName === claim);
            const guessCorrect = (guessIsTrue === actualClaimCorrect); const lastSenderId = offer.seenIds[offer.seenIds.length - 1];
            const winnerId = guessCorrect ? socket.id : lastSenderId; const loserId = guessCorrect ? lastSenderId : socket.id;
            room.revealData = { winnerId, penaltyId: loserId, guessCorrect, actualCard: card, claim };
            const winner = room.players.find(p => p.id === winnerId);
            if (claim === '왕카드' && winner && winner.penalties && winner.penalties.length > 0) { const extraIdx = Math.floor(Math.random() * winner.penalties.length); room.revealData.extraCard = winner.penalties.splice(extraIdx, 1)[0]; }
            room.phase = 'REVEAL'; pokerIo.to(roomCode).emit('revealStart', room);
            TimerHelper.add(room, () => {
                const curRoom = pokerRooms[roomCode]; if (!curRoom || curRoom.phase !== 'REVEAL') return;
                const curLoser = curRoom.players.find(p => p.id === loserId);
                if (curLoser) { curLoser.penalties.push(card); if (curRoom.revealData.extraCard) { curLoser.penalties.push(curRoom.revealData.extraCard); } }
                
                const activePlayers = curRoom.players.filter(p => !p.isSpectator);
                const penaltyLimit = activePlayers.length >= 7 ? 3 : 4; 
                let isGameOver = false;
                
                if (curLoser) {
                    const counts = {};
                    curLoser.penalties.forEach(c => { const aId = c.animalId || c.id.split('_')[0]; counts[aId] = (counts[aId] || 0) + 1; if (counts[aId] >= penaltyLimit) isGameOver = true; });
                    if (curLoser.handCount === 0) isGameOver = true;
                }
                if (isGameOver) { curRoom.phase = 'GAME_OVER'; curRoom.loserId = loserId; curRoom.activeOffer = null; pokerIo.to(roomCode).emit('roomUpdate', curRoom); } 
                else { curRoom.phase = 'GAME'; curRoom.turnId = loserId; curRoom.activeOffer = null; pokerIo.to(roomCode).emit('roundResolved', curRoom); }
            }, 5000);
        } catch (e) {}
    });
    socket.on('forceTurnSkip', ({ roomCode }) => { const room = pokerRooms[roomCode]; if (room) pokerIo.to(roomCode).emit('roomUpdate', room); });
    
    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = pokerRooms[roomCode]; if (!room) return;
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex === -1) return;
            
            const player = room.players[playerIndex];
            if (playerIndex === 0 && room.players.some(p => p.isBot) && !player.isSpectator) { 
                destroyRoom(pokerRooms, null, roomCode, pokerIo, '방장이 퇴장하여 방이 폭파되었습니다.'); 
                return; 
            }
            room.players.splice(playerIndex, 1);
            socket.leave(roomCode);
            
            if (room.players.length === 0) destroyRoom(pokerRooms, null, roomCode, pokerIo); 
            else pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    
    socket.on('disconnect', () => {
        try {
            for (let roomCode in pokerRooms) {
                const room = pokerRooms[roomCode]; 
                const playerIndex = room.players.findIndex(p => p.id === socket.id);
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];
                    if (playerIndex === 0 && room.players.some(p => p.isBot) && !player.isSpectator) { 
                        destroyRoom(pokerRooms, null, roomCode, pokerIo, '방장의 연결이 끊겨 방이 폭파되었습니다.'); 
                        continue; 
                    }
                    if (room.phase === 'LOBBY' || player.isSpectator) {
                        room.players.splice(playerIndex, 1);
                        if (room.players.length === 0) destroyRoom(pokerRooms, null, roomCode, pokerIo); 
                        else pokerIo.to(roomCode).emit('roomUpdate', room);
                    } else {
                        player.connected = false; 
                        player.isReconnecting = true;
                        room.paused = true; 
                        room.lastDisconnectTime = Date.now();
                        pokerIo.to(roomCode).emit('roomUpdate', room);
                    }
                }
            }
        } catch(e) {}
    });
});

// ==========================================
// [2] 플립 7
// ==========================================
const flip7Io = io.of('/flip7');
const flip7Rooms = {};
const flip7DisconnectTimers = {}; 
flip7Io.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!flip7Rooms[roomCode]) flip7Rooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], timeouts: new Set() };
            const room = flip7Rooms[roomCode];
            const disconnectKey = `${roomCode}_${userId}`;
            if (flip7DisconnectTimers[disconnectKey]) { clearTimeout(flip7DisconnectTimers[disconnectKey]); delete flip7DisconnectTimers[disconnectKey]; }
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            if (!existingPlayer) {
                const isSpectator = room.phase !== 'LOBBY';
                room.players.push({ id: socket.id, userId, name: userName, isBot, ready: room.players.length === 0, score: 0, connected: true, isSpectator });
            } else {
                existingPlayer.id = socket.id; existingPlayer.connected = true; socket.to(roomCode).emit('playerReconnected', { id: socket.id });
            }
            flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('playerReady', ({ roomCode, ready }) => {
        try { const room = flip7Rooms[roomCode]; if (room) { const player = room.players.find(p => p.id === socket.id); if (player) { player.ready = ready; flip7Io.to(roomCode).emit('roomUpdate', room); } } } catch(e) {}
    });
    socket.on('startGame', (roomCode) => { try { const room = flip7Rooms[roomCode]; if (room) { room.phase = 'GAME'; flip7Io.to(roomCode).emit('gameStarted', room); } } catch(e) {} });
    socket.on('sendGameStateSync', ({ roomCode, gameState }) => { try { socket.to(roomCode).emit('updateGameStateSync', gameState); } catch(e) {} });
    socket.on('requestSyncFromOthers', (roomCode) => { try { socket.to(roomCode).emit('provideGameState'); } catch(e) {} });
    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = flip7Rooms[roomCode]; if (!room) return;
            if (room.players.length > 0 && room.players[0].id === socket.id && room.players.some(p => p.isBot)) { destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io, '방장이 퇴장하여 방이 폭파되었습니다.'); return; }
            room.players = room.players.filter(p => p.id !== socket.id); socket.leave(roomCode);
            if (room.players.length === 0) destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io); else flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('disconnect', () => {
        try {
            for (let roomCode in flip7Rooms) {
                const room = flip7Rooms[roomCode]; const playerIndex = room.players.findIndex(p => p.id === socket.id);
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];
                    if (playerIndex === 0 && room.players.some(p => p.isBot)) { destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io, '방장의 연결이 끊겨 방이 폭파되었습니다.'); continue; }
                    player.connected = false; const disconnectKey = `${roomCode}_${player.userId}`;
                    if (flip7DisconnectTimers[disconnectKey]) clearTimeout(flip7DisconnectTimers[disconnectKey]);
                    if (room.phase === 'LOBBY') {
                        room.players.splice(playerIndex, 1);
                        if (room.players.length === 0) destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io); else flip7Io.to(roomCode).emit('roomUpdate', room);
                    } else {
                        flip7Io.to(roomCode).emit('playerDisconnected', { id: player.id, name: player.name });
                        flip7DisconnectTimers[disconnectKey] = setTimeout(() => {
                            delete flip7DisconnectTimers[disconnectKey]; const currentRoom = flip7Rooms[roomCode]; if (!currentRoom) return;
                            currentRoom.players = currentRoom.players.filter(p => p.userId !== player.userId);
                            if (currentRoom.players.length === 0) { destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io); } 
                            else { flip7Io.to(roomCode).emit('playerKicked', { userId: player.userId, name: player.name }); flip7Io.to(roomCode).emit('roomUpdate', currentRoom); }
                        }, 60000);
                    }
                }
            }
        } catch(e) {}
    });
});

// ==========================================
// 🗡️ [3] 쿠 전용
// ==========================================
const coupIo = io.of('/coup');
const coupRooms = {};
const coupDisconnectTimers = {}; 

function emitCoupUpdate(roomCode, room) {
    const now = Date.now();
    const safeRoom = { 
        ...room, 
        timer: room.timer ? { 
            duration: room.timer.duration,
            remaining: Math.max(0, (room.timer.endTime - now) / 1000)
        } : null 
    };
    coupIo.to(roomCode).emit('roomUpdate', safeRoom);
}

function clearCoupMainTimer(room) {
    if (room.timer && room.timer.timeoutId) { clearTimeout(room.timer.timeoutId); room.timer.timeoutId = null; }
    room.timer = null;
}

function startCoupTimer(room, roomCode, durationSec, callback) {
    clearCoupMainTimer(room);
    const durationMs = durationSec * 1000;
    const endTime = Date.now() + durationMs;
    room.timer = {
        endTime: endTime,
        duration: durationSec,
        timeoutId: setTimeout(() => { if (room.timer && room.timer.endTime === endTime) { room.timer = null; callback(); } }, durationMs)
    };
    emitCoupUpdate(roomCode, room);
}

const createCoupDeck = (playerCount) => {
    const chars = ['외교관', '사령관', '공작', '자객', '귀부인'];
    const copies = playerCount >= 7 ? 4 : 3;
    let deck = [];
    chars.forEach(c => { for(let i=0; i<copies; i++) deck.push(c); });
    return deck.sort(() => Math.random() - 0.5); 
};

function nextTurnCoup(room, roomCode) {
    clearCoupMainTimer(room);
    room.actionState = null; 
    
    const activePlayers = room.players.filter(p => !p.isDead);
    if (activePlayers.length <= 1) return;

    do { room.turnIndex = (room.turnIndex + 1) % room.players.length; } while (room.players[room.turnIndex].isDead);
    room.turnId = room.players[room.turnIndex].id;

    startCoupTimer(room, roomCode, 60, () => {
        const currentRoom = coupRooms[roomCode];
        if (!currentRoom || currentRoom.phase !== 'GAME') return;
        const actor = currentRoom.players.find(p => p.id === currentRoom.turnId);
        if (actor && !actor.isDead) {
            actor.coins += 1;
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '시간 초과로 소득(+1)을 획득했습니다' });
        }
        const alive = currentRoom.players.filter(p => !p.isDead);
        if (alive.length <= 1) {
            currentRoom.phase = 'GAME_OVER'; currentRoom.winner = alive[0]?.name || '생존자 없음'; emitCoupUpdate(roomCode, currentRoom);
        } else {
            nextTurnCoup(currentRoom, roomCode); emitCoupUpdate(roomCode, currentRoom);
        }
    });
}

function triggerAmbassadorDraw(room, roomCode, actor) {
    const aliveCards = actor.influence.filter(c => c.alive).map(c => c.role);
    const drawn1 = room.deck.pop();
    const drawn2 = room.deck.pop();
    const allFour = [...aliveCards, drawn1, drawn2];
    room.tempAmbassadorCards = { playerId: actor.id, drawnCards: allFour };
    
    room.actionState = { type: 'AMBASSADOR', actorId: actor.id, phase: 'WAIT_AMBASSADOR' };
    coupIo.to(roomCode).emit('startAmbassadorAnim', { actorId: actor.id, drawnCards: allFour });
    
    startCoupTimer(room, roomCode, 30, () => {
        const curRoom = coupRooms[roomCode];
        if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_AMBASSADOR') return;
        const p = curRoom.players.find(pl => pl.id === actor.id);
        if (p) { curRoom.actionState = null; nextTurnCoup(curRoom, roomCode); emitCoupUpdate(roomCode, curRoom); }
    });
    emitCoupUpdate(roomCode, room);
}

function setNextBlocker(room, roomCode) {
    const targetId = room.actionState.targetId;
    const targetPlayer = room.players.find(p => p.id === targetId);

    if ((room.actionState.type === 'ASSASSIN' || room.actionState.type === 'ASSASSIN_SECOND_STRIKE') && targetPlayer && !targetPlayer.isDead && !room.actionState.askedList.includes(targetPlayer.id)) {
        room.actionState.currentPromptId = targetPlayer.id;
        startCoupTimer(room, roomCode, 30, () => {
            const curRoom = coupRooms[roomCode];
            if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_BLOCK') return;
            const promptP = curRoom.players.find(p => p.id === curRoom.actionState.currentPromptId);
            if (promptP) processBlockResponse(curRoom, roomCode, promptP.id, false);
        });
        emitCoupUpdate(roomCode, room);
        return;
    }

    const actorIdx = room.players.findIndex(p => p.id === room.actionState.actorId);
    let nextIdx = (actorIdx + 1) % room.players.length;
    
    let found = false;
    for (let i = 0; i < room.players.length - 1; i++) {
        const p = room.players[nextIdx];
        if (!p.isDead && !room.actionState.askedList.includes(p.id)) {
            room.actionState.currentPromptId = p.id;
            found = true;
            break;
        }
        nextIdx = (nextIdx + 1) % room.players.length;
    }

    if (found) {
        startCoupTimer(room, roomCode, 30, () => {
            const curRoom = coupRooms[roomCode];
            if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_BLOCK') return;
            const promptP = curRoom.players.find(p => p.id === curRoom.actionState.currentPromptId);
            if (promptP) processBlockResponse(curRoom, roomCode, promptP.id, false);
        });
        emitCoupUpdate(roomCode, room);
    } else {
        clearCoupMainTimer(room);
        const actor = room.players.find(p => p.id === room.actionState.actorId);
        const target = room.players.find(p => p.id === room.actionState.targetId);
        if (actor) {
            if (room.actionState.type === 'FOREIGN_AID') {
                actor.coins += 2;
            } else if (room.actionState.type === 'DUKE') {
                actor.coins += 3;
            } else if (room.actionState.type === 'AMBASSADOR') {
                triggerAmbassadorDraw(room, roomCode, actor);
                return; 
            } else if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'ASSASSIN_SECOND_STRIKE') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '처치에 성공했습니다' });
                if (target && !target.isDead) {
                    room.actionState.phase = 'REVEAL_CARD';
                    room.actionState.revealerId = target.id;
                    room.actionState.type = 'ASSASSIN_DEATH';
                    emitCoupUpdate(roomCode, room);
                    startCoupTimer(room, roomCode, 30, () => {
                        const curRoom = coupRooms[roomCode];
                        if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'REVEAL_CARD') return;
                        const revealer = curRoom.players.find(p => p.id === curRoom.actionState.revealerId);
                        if (revealer) {
                            const idx = revealer.influence.findIndex(c => c.alive);
                            if (idx !== -1) processRevealCard(curRoom, roomCode, revealer.id, idx);
                        }
                    });
                    return;
                }
            } else if (room.actionState.type === 'CAPTAIN') {
                const stealAmount = Math.min(2, target ? target.coins : 0);
                if (target) target.coins -= stealAmount;
                actor.coins += stealAmount;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${actor.name}${getJosa(actor.name, '이/가')} 강탈에 성공합니다. +${stealAmount}코인을 가져갑니다` });
            }
        }
        room.actionState = null;
        nextTurnCoup(room, roomCode);
    }
    emitCoupUpdate(roomCode, room);
}

function processBlockResponse(room, roomCode, playerId, block, blockRole, blockType) {
    clearCoupMainTimer(room);
    const actor = room.players.find(p => p.id === room.actionState.actorId);

    if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'ASSASSIN_SECOND_STRIKE') {
        const isSecondStrike = room.actionState.type === 'ASSASSIN_SECOND_STRIKE';
        if (block) {
            if (blockType === 'CHALLENGE') {
                room.actionState.phase = 'REVEAL_CARD';
                room.actionState.type = 'ASSASSIN_CHALLENGE_REVEAL';
                room.actionState.revealerId = room.actionState.actorId;
                emitCoupUpdate(roomCode, room);
                startCoupTimer(room, roomCode, 30, () => {
                    const curRoom = coupRooms[roomCode];
                    if (curRoom && curRoom.actionState && curRoom.actionState.phase === 'REVEAL_CARD') {
                        const p = curRoom.players.find(pl => pl.id === curRoom.actionState.revealerId);
                        if (p) {
                            const idx = p.influence.findIndex(c => c.alive);
                            if (idx !== -1) processRevealCard(curRoom, roomCode, p.id, idx);
                        }
                    }
                });
            } else {
                room.actionState.blockerId = playerId;
                room.actionState.phase = 'WAIT_CHALLENGE';
                room.actionState.type = isSecondStrike ? 'ASSASSIN_SECOND_STRIKE_BLOCK_CHALLENGE' : 'ASSASSIN_BLOCK_CHALLENGE';
                room.actionState.blockRole = '귀부인'; 
                emitCoupUpdate(roomCode, room);
                startCoupTimer(room, roomCode, 30, () => {
                    const curRoom = coupRooms[roomCode];
                    if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_CHALLENGE') return;
                    const actorP = curRoom.players.find(p => p.id === curRoom.actionState.actorId);
                    if (actorP) processChallengeResponse(curRoom, roomCode, actorP.id, false); 
                });
            }
        } else {
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.type = 'ASSASSIN_DEATH'; 
            room.actionState.revealerId = playerId;
            const targetName = room.players.find(p => p.id === playerId)?.name || '';
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${targetName}${getJosa(targetName, '이/가')} 암살당했습니다` });
            emitCoupUpdate(roomCode, room);
            startCoupTimer(room, roomCode, 30, () => {
                const curRoom = coupRooms[roomCode];
                if (curRoom && curRoom.actionState && curRoom.actionState.phase === 'REVEAL_CARD') {
                    const p = curRoom.players.find(pl => pl.id === curRoom.actionState.revealerId);
                    if (p) {
                        const idx = p.influence.findIndex(c => c.alive);
                        if (idx !== -1) processRevealCard(curRoom, roomCode, p.id, idx);
                    }
                }
            });
        }
        return;
    }

    if (block) { 
        room.actionState.blockerId = playerId;
        room.actionState.blockRole = blockRole || (room.actionState.type === 'FOREIGN_AID' || room.actionState.type === 'DUKE' ? '공작' : (room.actionState.type === 'AMBASSADOR' ? '외교관' : '사령관'));

        room.actionState.phase = 'WAIT_CHALLENGE';
        emitCoupUpdate(roomCode, room);
        startCoupTimer(room, roomCode, 30, () => {
            const curRoom = coupRooms[roomCode];
            if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_CHALLENGE') return;
            const actorP = curRoom.players.find(p => p.id === curRoom.actionState.actorId);
            if (actorP) processChallengeResponse(curRoom, roomCode, actorP.id, false); 
        });
    } else { 
        room.actionState.askedList.push(playerId);
        coupIo.to(roomCode).emit('showOkEmote', playerId); 
        setNextBlocker(room, roomCode);
    }
    emitCoupUpdate(roomCode, room);
}

function processChallengeResponse(room, roomCode, playerId, challenge) {
    clearCoupMainTimer(room);
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    const actorName = actor ? actor.name : '';
    
    if (room.actionState.type === 'ASSASSIN_BLOCK_CHALLENGE' || room.actionState.type === 'ASSASSIN_SECOND_STRIKE_BLOCK_CHALLENGE') {
        if (challenge) { 
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.revealerId = room.actionState.blockerId;
            room.actionState.type = room.actionState.type === 'ASSASSIN_BLOCK_CHALLENGE' ? 'ASSASSIN_BLOCK_REVEAL' : 'ASSASSIN_SECOND_STRIKE_BLOCK_REVEAL';
            emitCoupUpdate(roomCode, room);
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
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: '경호에 성공했습니다' });
            room.actionState = null;
            nextTurnCoup(room, roomCode);
            emitCoupUpdate(roomCode, room);
        }
        return;
    }

    if (room.actionState.type === 'CAPTAIN_BLOCK' || room.actionState.type === 'CAPTAIN_CHALLENGE') {
        if (challenge) { 
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.revealerId = room.actionState.type === 'CAPTAIN_BLOCK' ? room.actionState.blockerId : room.actionState.actorId;
            room.actionState.type = room.actionState.type === 'CAPTAIN_BLOCK' ? 'CAPTAIN_BLOCK_REVEAL' : 'CAPTAIN_CHALLENGE_REVEAL';
            emitCoupUpdate(roomCode, room);
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
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${actorName}${getJosa(actorName, '이/가')} 강탈을 방해받았습니다` });
            room.actionState = null;
            nextTurnCoup(room, roomCode);
            emitCoupUpdate(roomCode, room);
        }
        return;
    }

    if (room.actionState.type === 'DUKE' || room.actionState.type === 'AMBASSADOR') {
        if (challenge) { 
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.revealerId = room.actionState.actorId; 
            room.actionState.type = room.actionState.type === 'DUKE' ? 'DUKE_REVEAL' : 'AMBASSADOR_REVEAL';
            emitCoupUpdate(roomCode, room);
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
            if (room.actionState.type === 'DUKE') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '징세를 포기하여 징세에 실패했습니다' });
            } else {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${actorName}${getJosa(actorName, '이/가')} 교환에 실패했습니다` });
            }
            room.actionState = null;
            nextTurnCoup(room, roomCode);
            emitCoupUpdate(roomCode, room);
        }
        return;
    }

    if (challenge) { 
        room.actionState.phase = 'REVEAL_CARD';
        room.actionState.revealerId = room.actionState.blockerId;
        if (room.actionState.type === 'FOREIGN_AID') {
            room.actionState.type = 'FOREIGN_AID_BLOCK_CHALLENGE';
        }
        emitCoupUpdate(roomCode, room);
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
        if (room.actionState.type === 'FOREIGN_AID') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '공작의 방해로 해외 원조에 실패했습니다' });
        } else {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '행동에 실패하였습니다' });
        }
        room.actionState = null;
        nextTurnCoup(room, roomCode);
    }
    emitCoupUpdate(roomCode, room);
}

function processRevealCard(room, roomCode, revealerId, cardIndex) {
    clearCoupMainTimer(room);
    const revealer = room.players.find(p => p.id === revealerId);
    if (!revealer) return;
    const card = revealer.influence[cardIndex];
    if (!card || !card.alive) return;

    if (room.actionState && room.actionState.phase !== 'REVEAL_CARD' && room.actionState.phase !== 'REVEAL_ANIMATING') return;
    if (room.actionState) room.actionState.phase = 'REVEAL_ANIMATING';

    const actionType = room.actionState ? room.actionState.type : '';
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    
    let isSuccess = false;

    if (actionType === 'ASSASSIN_CHALLENGE_REVEAL') {
        isSuccess = (card.role === '자객');
    } else if (actionType === 'ASSASSIN_BLOCK_REVEAL' || actionType === 'ASSASSIN_SECOND_STRIKE_BLOCK_REVEAL') {
        isSuccess = (card.role === '귀부인');
    } else if (actionType === 'CAPTAIN_BLOCK_REVEAL') {
        isSuccess = (card.role === room.actionState.blockRole);
    } else if (actionType === 'CAPTAIN_CHALLENGE_REVEAL') {
        isSuccess = (card.role === '사령관');
    } else if (actionType === 'DUKE_REVEAL' || actionType === 'FOREIGN_AID' || actionType === 'FOREIGN_AID_BLOCK_CHALLENGE') {
        isSuccess = (card.role === '공작');
    } else if (actionType === 'AMBASSADOR_REVEAL') {
        isSuccess = (card.role === '외교관');
    }

    coupIo.to(roomCode).emit('blockRevealAnimation', { revealerId: revealer.id, cardIndex: cardIndex, revealedRole: card.role, isSuccess: isSuccess });

    if (actionType === 'ASSASSIN_CHALLENGE_REVEAL' && !isSuccess) {
        coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${revealer.name}님이 자객 증명에 실패하여 카드를 잃고 사망합니다` });
    } else if ((actionType === 'ASSASSIN_BLOCK_REVEAL' || actionType === 'ASSASSIN_SECOND_STRIKE_BLOCK_REVEAL') && !isSuccess) {
        coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: '귀부인이 아니므로 카드를 잃고, 암살도 적용되어 사망합니다' });
    } else if (actionType === 'CAPTAIN_BLOCK_REVEAL' && !isSuccess) {
        coupIo.to(roomCode).emit('actionAnnounce', { actorName: revealer.name, actionText: '방해에 실패하여 카드를 잃고 강탈이 적용됩니다' });
    } else if (actionType === 'CAPTAIN_CHALLENGE_REVEAL' && !isSuccess) {
        coupIo.to(roomCode).emit('actionAnnounce', { actorName: revealer.name, actionText: '사령관이 아니므로 카드를 잃고 강탈에 실패했습니다' });
    }

    TimerHelper.add(room, () => {
        const currentRoom = coupRooms[roomCode];
        if (!currentRoom) return;
        const currentRevealer = currentRoom.players.find(p => p.id === revealerId);
        if (!currentRevealer) return;
        
        const curRevealerName = currentRevealer.name;
        const currentCard = currentRevealer.influence[cardIndex];
        const curActionType = currentRoom.actionState ? currentRoom.actionState.type : '';
        const currentActor = currentRoom.players.find(p => p.id === currentRoom.actionState?.actorId);
        const curActorName = currentActor ? currentActor.name : '';
        const currentTarget = currentRoom.players.find(p => p.id === currentRoom.actionState?.targetId);

        const startRevealTimer = (rId) => {
            startCoupTimer(currentRoom, roomCode, 30, () => {
                const rRoom = coupRooms[roomCode];
                if (rRoom && rRoom.actionState && rRoom.actionState.phase === 'REVEAL_CARD') {
                    const p = rRoom.players.find(pl => pl.id === rRoom.actionState.revealerId);
                    if (p) {
                        const idx = p.influence.findIndex(c => c.alive);
                        if (idx !== -1) processRevealCard(rRoom, roomCode, p.id, idx);
                    }
                }
            });
        };
        const startBlockTimer = (pId) => {
            startCoupTimer(currentRoom, roomCode, 30, () => {
                const rRoom = coupRooms[roomCode];
                if (rRoom && rRoom.actionState && rRoom.actionState.phase === 'WAIT_BLOCK') {
                    processBlockResponse(rRoom, roomCode, pId, false);
                }
            });
        };

        if (isSuccess && ['ASSASSIN_CHALLENGE_REVEAL', 'ASSASSIN_BLOCK_REVEAL', 'ASSASSIN_SECOND_STRIKE_BLOCK_REVEAL', 'CAPTAIN_BLOCK_REVEAL', 'CAPTAIN_CHALLENGE_REVEAL', 'DUKE_REVEAL', 'AMBASSADOR_REVEAL', 'FOREIGN_AID_BLOCK_CHALLENGE'].includes(curActionType)) {
            
            const matchedRole = currentCard.role;
            currentRoom.deck.push(matchedRole);
            currentRoom.deck.sort(() => Math.random() - 0.5);
            currentCard.role = currentRoom.deck.pop();

            if (curActionType === 'ASSASSIN_CHALLENGE_REVEAL') {
                currentRoom.actionState = { ...currentRoom.actionState, phase: 'REVEAL_CARD', type: 'ASSASSIN_CHALLENGE_FAIL_PENALTY', revealerId: currentRoom.actionState.targetId };
                emitCoupUpdate(roomCode, currentRoom);
                startRevealTimer(currentRoom.actionState.revealerId);
                return;
            } 
            else if (curActionType === 'ASSASSIN_BLOCK_REVEAL' || curActionType === 'ASSASSIN_SECOND_STRIKE_BLOCK_REVEAL') {
                currentRoom.actionState = { ...currentRoom.actionState, phase: 'REVEAL_CARD', type: 'ASSASSIN_BLOCK_FAIL_PENALTY', revealerId: currentRoom.actionState.actorId };
                emitCoupUpdate(roomCode, currentRoom);
                startRevealTimer(currentRoom.actionState.revealerId);
                return;
            }
            else if (curActionType === 'CAPTAIN_BLOCK_REVEAL' || curActionType === 'CAPTAIN_CHALLENGE_REVEAL') {
                if (curActionType === 'CAPTAIN_CHALLENGE_REVEAL') {
                    const stealAmount = Math.min(2, currentTarget ? currentTarget.coins : 0);
                    if (currentTarget) currentTarget.coins -= stealAmount;
                    if (currentActor) currentActor.coins += stealAmount;
                }
                currentRoom.actionState = {
                    ...currentRoom.actionState, phase: 'REVEAL_CARD', 
                    type: curActionType === 'CAPTAIN_BLOCK_REVEAL' ? 'CAPTAIN_BLOCK_PENALTY' : 'CAPTAIN_CHALLENGE_PENALTY',
                    revealerId: curActionType === 'CAPTAIN_BLOCK_REVEAL' ? currentRoom.actionState.actorId : currentRoom.actionState.blockerId
                };
                emitCoupUpdate(roomCode, currentRoom);
                startRevealTimer(currentRoom.actionState.revealerId);
                return;
            }
            else if (curActionType === 'DUKE_REVEAL' || curActionType === 'AMBASSADOR_REVEAL') {
                if (curActionType === 'DUKE_REVEAL') {
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '공작을 증명하여 징세(+3코인)를 획득하고, 방해자는 패널티를 받습니다!' });
                    if (currentActor && !currentActor.isDead) currentActor.coins += 3;
                } else {
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '외교관을 증명하여 의심자에게 패널티를 부여합니다!' });
                }
                currentRoom.actionState = {
                    ...currentRoom.actionState, phase: 'REVEAL_CARD', type: 'CHALLENGER_PENALTY', revealerId: currentRoom.actionState.blockerId,
                    pendingAction: curActionType === 'AMBASSADOR_REVEAL' ? 'AMBASSADOR_DRAW' : null 
                };
                emitCoupUpdate(roomCode, currentRoom);
                startRevealTimer(currentRoom.actionState.revealerId);
                return;
            }
            else if (curActionType === 'FOREIGN_AID_BLOCK_CHALLENGE') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전에 실패하여 원조를 받지 못하고 패널티를 받습니다' });
                currentRoom.actionState = { ...currentRoom.actionState, phase: 'REVEAL_CARD', type: 'CHALLENGER_PENALTY', revealerId: currentRoom.actionState.actorId };
                emitCoupUpdate(roomCode, currentRoom);
                startRevealTimer(currentRoom.actionState.revealerId);
                return;
            }
        }

        currentCard.alive = false; 

        if ((curActionType === 'ASSASSIN_BLOCK_REVEAL' || curActionType === 'ASSASSIN_SECOND_STRIKE_BLOCK_REVEAL') && !isSuccess) {
            const secondIdx = currentRevealer.influence.findIndex(c => c.alive);
            if (secondIdx !== -1) {
                currentRevealer.influence[secondIdx].alive = false;
                coupIo.to(roomCode).emit('blockRevealAnimation', { revealerId: currentRevealer.id, cardIndex: secondIdx, revealedRole: currentRevealer.influence[secondIdx].role, isSuccess: false });
            }
        }

        const hasAliveCards = currentRevealer.influence.some(c => c.alive);
        if (!hasAliveCards) currentRevealer.isDead = true;

        if (curActionType === 'CHALLENGER_PENALTY') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전/의심 실패로 카드를 잃었습니다' });
        } else if (curActionType === 'ASSASSIN_CHALLENGE_FAIL_PENALTY') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: '의심 실패로 카드를 잃습니다' });
        } else if (curActionType === 'ASSASSIN_BLOCK_FAIL_PENALTY') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: '대상이 귀부인을 증명하여 카드를 잃습니다' });
        } else if (curActionType === 'CAPTAIN_BLOCK_PENALTY') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '강탈을 저지당하여 카드를 잃습니다' });
        } else if (curActionType === 'CAPTAIN_CHALLENGE_PENALTY') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: curRevealerName, actionText: '의심 실패로 카드를 잃습니다' });
        } else if (curActionType === 'DUKE_REVEAL' && !isSuccess) {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '공작이 아니므로 카드를 잃고 징세에 실패했습니다' });
        } else if (curActionType === 'AMBASSADOR_REVEAL' && !isSuccess) {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '외교관이 아니므로 카드를 잃고 교환에 실패했습니다' });
        } else if (curActionType === 'FOREIGN_AID_BLOCK_CHALLENGE' && !isSuccess) {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전에 성공하여 방해를 뚫고 해외 원조를 받습니다!' });
            if (currentActor && !currentActor.isDead) currentActor.coins += 2;
        } else if (curActionType === 'CAPTAIN_BLOCK_REVEAL' && !isSuccess) {
            const stealAmount = Math.min(2, currentTarget ? currentTarget.coins : 0);
            if (currentTarget) currentTarget.coins -= stealAmount;
            if (currentActor) currentActor.coins += stealAmount;
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${curActorName}${getJosa(curActorName, '이/가')} 강탈(+${stealAmount}코인)에 성공했습니다` });
        }

        const alivePlayers = currentRoom.players.filter(p => !p.isDead);
        if (alivePlayers.length <= 1) {
            currentRoom.phase = 'GAME_OVER';
            currentRoom.winner = alivePlayers[0]?.name || '생존자 없음';
            currentRoom.actionState = null;
            emitCoupUpdate(roomCode, currentRoom);
            return;
        }

        if (curActionType === 'ASSASSIN_CHALLENGE_FAIL_PENALTY' && !currentRevealer.isDead) {
            currentRoom.actionState.phase = 'WAIT_BLOCK';
            currentRoom.actionState.type = 'ASSASSIN_SECOND_STRIKE';
            currentRoom.actionState.currentPromptId = currentRevealer.id;
            currentRoom.actionState.askedList = [];
            emitCoupUpdate(roomCode, currentRoom);
            startBlockTimer(currentRoom.actionState.currentPromptId);
            return;
        }

        if (currentRoom.actionState && currentRoom.actionState.pendingAction === 'AMBASSADOR_DRAW') {
            const originalActor = currentRoom.players.find(p => p.id === currentRoom.actionState.actorId);
            if (originalActor && !originalActor.isDead) {
                triggerAmbassadorDraw(currentRoom, roomCode, originalActor);
                return;
            }
        }

        currentRoom.actionState = null;
        nextTurnCoup(currentRoom, roomCode);
        emitCoupUpdate(roomCode, currentRoom);

    }, 3000);
}

coupIo.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!coupRooms[roomCode]) {
                coupRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], spectators: [], turnIndex: 0, deck: [], actionState: null, timer: null, timeouts: new Set() };
            }
            const room = coupRooms[roomCode];

            const disconnectKey = `${roomCode}_${userId}`;
            if (coupDisconnectTimers[disconnectKey]) {
                clearTimeout(coupDisconnectTimers[disconnectKey]);
                delete coupDisconnectTimers[disconnectKey];
            }

            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || p.name === userName);
            
            if (!existingPlayer) {
                if (room.phase === 'GAME') {
                    if (!room.spectators) room.spectators = [];
                    let existingSpec = room.spectators.find(s => (userId && s.userId === userId) || s.name === userName);
                    if (!existingSpec) {
                        room.spectators.push({ id: socket.id, userId, name: userName });
                    } else {
                        existingSpec.id = socket.id;
                    }
                    emitCoupUpdate(roomCode, room);
                    return;
                }

                room.players.push({
                    id: socket.id, name: userName, userId, isBot, ready: room.players.length === 0,
                    coins: 2, influence: [], isDead: false, connected: true
                });
            } else {
                const oldId = existingPlayer.id;

                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
                existingPlayer.isReconnecting = false;
                
                if (room.spectators) room.spectators = room.spectators.filter(s => s.userId !== userId);
                if (room.turnId === oldId) room.turnId = socket.id;
                
                if (room.actionState) {
                    if (room.actionState.actorId === oldId) room.actionState.actorId = socket.id;
                    if (room.actionState.targetId === oldId) room.actionState.targetId = socket.id;
                    if (room.actionState.currentPromptId === oldId) room.actionState.currentPromptId = socket.id;
                    if (room.actionState.revealerId === oldId) room.actionState.revealerId = socket.id;
                    if (room.actionState.blockerId === oldId) room.actionState.blockerId = socket.id;
                    
                    if (room.actionState.askedList) {
                        room.actionState.askedList = room.actionState.askedList.map(id => id === oldId ? socket.id : id);
                    }
                }

                if (room.tempAmbassadorCards && room.tempAmbassadorCards.playerId === oldId) {
                    room.tempAmbassadorCards.playerId = socket.id;
                }
                
                if(room.phase === 'GAME' && !existingPlayer.isDead) {
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${existingPlayer.name}님이 재접속했습니다` });
                }
            }
            emitCoupUpdate(roomCode, room);
        } catch(e) { console.error('Coup joinRoom error:', e); }
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = coupRooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; emitCoupUpdate(roomCode, room); }
            }
        } catch(e) { console.error('Coup playerReady error:', e); }
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
        } catch(e) { console.error('Coup startGame error:', e); }
    });

    socket.on('sendPassEmote', ({ roomCode }) => {
        io.to(roomCode).emit('showPassEmote', socket.id);
    });

    socket.on('submitAction', ({ roomCode, action, targetId }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room) return;

            const actor = room.players.find(p => p.id === socket.id);
            const target = room.players.find(p => p.id === targetId);

            if (!actor || socket.id !== room.turnId || actor.isDead || room.actionState) return;
            if (actor.coins >= 10 && action !== 'COUP') return;

            clearCoupMainTimer(room);

            if (action === 'CAPTAIN' && target) {
                room.actionState = { type: 'CAPTAIN', actorId: actor.id, targetId: target.id, askedList: [], phase: 'WAIT_BLOCK' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '강탈을 시도합니다' });
                setNextBlocker(room, roomCode);
                emitCoupUpdate(roomCode, room);
                return;
            }

            if (action === 'INCOME') {
                actor.coins += 1;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '소득으로 +1코인을 획득합니다' });
                nextTurnCoup(room, roomCode);
                emitCoupUpdate(roomCode, room);
                return;
            } else if (action === 'FOREIGN_AID') {
                room.actionState = { type: 'FOREIGN_AID', actorId: actor.id, askedList: [], phase: 'WAIT_BLOCK' };
                setNextBlocker(room, roomCode);
                return;
            } else if (action === 'DUKE') {
                room.actionState = { type: 'DUKE', actorId: actor.id, askedList: [], phase: 'WAIT_BLOCK' };
                setNextBlocker(room, roomCode);
                return;
            } else if (action === 'AMBASSADOR') {
                room.actionState = { type: 'AMBASSADOR', actorId: actor.id, askedList: [], phase: 'WAIT_BLOCK' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '카드를 교환합니다' });
                setNextBlocker(room, roomCode);
                return;
            } else if (action === 'ASSASSIN' && target) {
                actor.coins -= 3;
                room.actionState = { type: 'ASSASSIN', actorId: actor.id, targetId: target.id, askedList: [], phase: 'WAIT_BLOCK' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${actor.name}${getJosa(actor.name, '이/가')} ${target.name}${getJosa(target.name, '을/를')} 암살시도합니다` });
                setNextBlocker(room, roomCode);
                return;
            } else if (action === 'COUP' && target) {
                actor.coins -= 7;
                room.actionState = { type: 'COUP', actorId: actor.id, revealerId: target.id, phase: 'REVEAL_CARD' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${target.name}에게 쿠를 사용했습니다` });
                emitCoupUpdate(roomCode, room);
                startCoupTimer(room, roomCode, 30, () => {
                    const currentRoom = coupRooms[roomCode];
                    if (!currentRoom || !currentRoom.actionState || currentRoom.actionState.phase !== 'REVEAL_CARD') return;
                    
                    currentRoom.actionState.phase = 'REVEAL_ANIMATING';
                    const revealer = currentRoom.players.find(p => p.id === currentRoom.actionState.revealerId);
                    if (revealer) {
                        const idx = revealer.influence.findIndex(c => c.alive);
                        if (idx !== -1) processRevealCard(currentRoom, roomCode, revealer.id, idx);
                    }
                });
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
        } catch(e) { console.error('Coup submitAction error:', e); }
    });

    socket.on('ambassadorChosen', ({ roomCode, keepIndices, returnIndices }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_AMBASSADOR' || room.actionState.actorId !== socket.id) return;
            
            clearCoupMainTimer(room);
            const player = room.players.find(p => p.id === socket.id);
            if (!player || !room.tempAmbassadorCards) return;

            const allCards = room.tempAmbassadorCards.drawnCards;
            const keptRoles = keepIndices.map(idx => allCards[idx]).filter(Boolean);
            const returnedRoles = returnIndices.map(idx => allCards[idx]).filter(Boolean);

            let keptIdx = 0;
            player.influence.forEach(c => {
                if (c.alive && keptIdx < keptRoles.length) {
                    c.role = keptRoles[keptIdx++];
                }
            });

            returnedRoles.forEach(r => room.deck.push(r));
            room.deck.sort(() => Math.random() - 0.5);

            room.tempAmbassadorCards = null;
            room.actionState = null;

            coupIo.to(roomCode).emit('actionAnnounce', { actorName: player.name, actionText: '카드를 교환하였습니다' });
            nextTurnCoup(room, roomCode);
            emitCoupUpdate(roomCode, room);
        } catch(e) { console.error('Coup ambassadorChosen error:', e); }
    });

    socket.on('blockResponse', ({ roomCode, block, blockRole, blockType }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_BLOCK' || room.actionState.currentPromptId !== socket.id) return;
            
            if (room.actionState.type === 'CAPTAIN') {
                clearCoupMainTimer(room);
                if (block) {
                    if (blockType === 'CHALLENGE') {
                        room.actionState.blockerId = socket.id;
                        room.actionState.phase = 'WAIT_CHALLENGE';
                        room.actionState.type = 'CAPTAIN_CHALLENGE';
                        emitCoupUpdate(roomCode, room);
                        startCoupTimer(room, roomCode, 30, () => {
                             const curRoom = coupRooms[roomCode];
                             if (curRoom && curRoom.actionState && curRoom.actionState.phase === 'WAIT_CHALLENGE') {
                                 processChallengeResponse(curRoom, roomCode, curRoom.actionState.actorId, false);
                             }
                        });
                    } else {
                        room.actionState.blockerId = socket.id;
                        room.actionState.phase = 'WAIT_CHALLENGE';
                        room.actionState.type = 'CAPTAIN_BLOCK';
                        room.actionState.blockRole = blockRole; 
                        emitCoupUpdate(roomCode, room);
                        startCoupTimer(room, roomCode, 30, () => {
                             const curRoom = coupRooms[roomCode];
                             if (curRoom && curRoom.actionState && curRoom.actionState.phase === 'WAIT_CHALLENGE') {
                                 processChallengeResponse(curRoom, roomCode, curRoom.actionState.actorId, false);
                             }
                        });
                    }
                } else {
                    room.actionState.askedList.push(socket.id);
                    coupIo.to(roomCode).emit('showOkEmote', socket.id);
                    setNextBlocker(room, roomCode);
                }
                return;
            }

            if (['ASSASSIN', 'ASSASSIN_SECOND_STRIKE', 'FOREIGN_AID', 'DUKE', 'AMBASSADOR'].includes(room.actionState.type)) {
                clearCoupMainTimer(room);
                processBlockResponse(room, roomCode, socket.id, block, blockRole, blockType);
                return;
            }

            processBlockResponse(room, roomCode, socket.id, block, blockRole, blockType);
        } catch(e){ console.error('Coup blockResponse error:', e); }
    });

    socket.on('challengeResponse', ({ roomCode, challenge }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_CHALLENGE' || room.actionState.actorId !== socket.id) return;
            processChallengeResponse(room, roomCode, socket.id, challenge);
        } catch(e){ console.error('Coup challengeResponse error:', e); }
    });

    socket.on('revealCard', ({ roomCode, cardIndex }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'REVEAL_CARD' || room.actionState.revealerId !== socket.id) return;
            
            room.actionState.phase = 'REVEAL_ANIMATING';
            processRevealCard(room, roomCode, socket.id, cardIndex);
        } catch(e){ console.error('Coup revealCard error:', e); }
    });

    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = coupRooms[roomCode];
            if (!room) return;

            if (room.players.length > 0 && room.players[0].id === socket.id && room.players.some(p => p.isBot)) {
                destroyRoom(coupRooms, coupDisconnectTimers, roomCode, coupIo, '방장이 퇴장하여 방이 폭파되었습니다.');
                return;
            }

            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.spectators) room.spectators = room.spectators.filter(s => s.id !== socket.id);
            socket.leave(roomCode);
            
            if (room.players.length === 0) {
                destroyRoom(coupRooms, coupDisconnectTimers, roomCode, coupIo);
            } else {
                emitCoupUpdate(roomCode, room);
            }
        } catch(e){ console.error('Coup leaveRoom error:', e); }
    });

    socket.on('disconnect', () => {
        try {
            for (let roomCode in coupRooms) {
                const room = coupRooms[roomCode];
                
                if (room.spectators) room.spectators = room.spectators.filter(s => s.id !== socket.id);

                const playerIndex = room.players.findIndex(p => p.id === socket.id);
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];

                    if (playerIndex === 0 && room.players.some(p => p.isBot)) {
                        destroyRoom(coupRooms, coupDisconnectTimers, roomCode, coupIo, '방장의 연결이 끊겨 방이 폭파되었습니다.');
                        continue;
                    }

                    player.connected = false;
                    const disconnectKey = `${roomCode}_${player.userId}`;
                    
                    if (coupDisconnectTimers[disconnectKey]) clearTimeout(coupDisconnectTimers[disconnectKey]);
                    
                    if (room.phase === 'LOBBY') {
                        room.players = room.players.filter(p => p.id !== socket.id);
                        if (room.players.length === 0) {
                            destroyRoom(coupRooms, coupDisconnectTimers, roomCode, coupIo);
                        } else {
                            emitCoupUpdate(roomCode, room);
                        }
                    } else {
                        coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${player.name}님의 연결이 끊겼습니다. (60초 후 퇴장)` });
                        emitCoupUpdate(roomCode, room); 

                        coupDisconnectTimers[disconnectKey] = setTimeout(() => {
                            delete coupDisconnectTimers[disconnectKey];
                            const currentRoom = coupRooms[roomCode];
                            if (!currentRoom) return;
                            
                            currentRoom.players = currentRoom.players.filter(p => p.userId !== player.userId);
                            if (currentRoom.players.length === 0) {
                                destroyRoom(coupRooms, coupDisconnectTimers, roomCode, coupIo);
                            } else {
                                coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${player.name}님이 60초 경과로 강퇴되었습니다.` });
                                
                                if (currentRoom.turnId === player.id) {
                                    nextTurnCoup(currentRoom, roomCode);
                                } else if (currentRoom.actionState && currentRoom.actionState.currentPromptId === player.id) {
                                    processBlockResponse(currentRoom, roomCode, player.id, false, null, null);
                                }
                                emitCoupUpdate(roomCode, currentRoom);
                            }
                        }, 60000);
                    }
                }
            }
        } catch(e) { console.error('Coup disconnect error:', e); }
    });
});

// ==========================================
// ⛏️ [4] 사보타지 전용 (Namespace: /sabo)
// ==========================================
const saboIo = io.of('/sabo');
const saboRooms = {};
const saboDisconnectTimers = {};

const SABO_DEST_ROWS = [2, 4, 6];

const PATH_EDGES = {
    '01': [1,1,1,1], '02': [1,1,1,1], 
    '03': [1,0,1,0], '04': [0,1,0,1], '05': [1,1,0,0], '06': [1,0,0,1], '07': [1,1,1,0],
    '08': [1,1,1,1], '09': [1,1,0,1],
    '10': { edges: [1,1,1,1], links: [] }, '11': { edges: [1,0,1,1], links: [] }, '12': { edges: [1,1,0,1], links: [] }, 
    '13': { edges: [0,0,1,1], links: [] }, '14': { edges: [0,1,0,1], links: [] }, '15': { edges: [0,1,1,0], links: [] }, 
    '16': { edges: [1,0,1,0], links: [] }, '17': { edges: [0,0,1,0], links: [] }, '18': { edges: [0,0,0,1], links: [] }, 
    '21': { edges: [1, 1, 1, 0], links: [[1, 2]] }, '22': { edges: [1, 1, 1, 0], links: [[0,2]] }, 
    '23': { edges: [1, 1, 1, 0], links: [[1,2]] }, '24': { edges: [1, 1, 1, 1], links: [[0,2]] }, 
    '25': { edges: [1, 1, 1, 1], links: [[1,3]] }, '26': { edges: [1, 1, 1, 1], links: [[0,3], [1,2]] }, 
    '27': { edges: [1, 1, 1, 0], links: [[0,1]] }, '28': { edges: [1, 1, 1, 1], links: [[0,1], [2,3]] },
    '29': { edges: [1, 1, 1, 1], links: [[0, 2], [1, 3]] },
    '31': [1,1,1,1], '32': { edges: [0,0,0,1], links: [] }, '33': { edges: [1, 1, 1, 1], links: [[1, 2, 3]] },  '34': { edges: [1, 1, 1, 1], links: [[0, 2, 3]] },
    '35': [0,1,1,1], '36': { edges: [0, 0, 1, 0], links: [] }, '37': { edges: [1, 1, 1, 0], links: [[0, 1, 2]] }, '38': { edges: [0, 1, 1, 1], links: [[1, 3]] },
    '41': { edges: [1, 1, 1, 0], links: [[0, 2]] }, '42': [0,1,0,1], '43': [0,1,1,0], '44': [0,1,0,1], '45': [1,0,1,0], '46': [0,0,1,0],
    '47': [0,0,0,1], '48': [1,1,0,0], '49': [1,0,0,1], '50': [0,0,1,0]
};

function getCardEdges(imgCode, isRotated) {
    const data = PATH_EDGES[imgCode] || [1,1,1,1];
    const baseEdges = Array.isArray(data) ? data : data.edges;
    const links = Array.isArray(data) ? null : data.links;
    let top, right, bottom, left;
    
    if (isRotated) { top = baseEdges[2]; right = baseEdges[3]; bottom = baseEdges[0]; left = baseEdges[1]; } 
    else { top = baseEdges[0]; right = baseEdges[1]; bottom = baseEdges[2]; left = baseEdges[3]; }
    
    let internalLinks = [];
    if (links) { 
        internalLinks = links.map(group => group.map(dir => isRotated ? (dir + 2) % 4 : dir)); 
    } else {
        const allConnected = [];
        if (top === 1) allConnected.push(0); if (right === 1) allConnected.push(1);
        if (bottom === 1) allConnected.push(2); if (left === 1) allConnected.push(3);
        internalLinks = [allConnected];
    }
    return { top, right, bottom, left, internalLinks };
}

function isDestConnectedToStart(board, destCol, destRow) {
    const occupied = new Map();
    occupied.set('2,4', { top: 1, right: 1, bottom: 1, left: 1, internalLinks: [[0,1,2,3]] });
    
    board.forEach(c => { 
        occupied.set(`${c.col},${c.row}`, getCardEdges(c.imgCode, c.isRotated)); 
    });

    const connectedPorts = new Set();
    const queue = [];
    
    [0, 1, 2, 3].forEach(d => {
        connectedPorts.add(`2,4,${d}`);
        queue.push({ col: 2, row: 4, outDir: d });
    });

    const DIR_OFFSETS = [ 
        { dc: 0, dr: -1, opp: 2, name: 'top' }, 
        { dc: 1, dr: 0, opp: 3, name: 'right' }, 
        { dc: 0, dr: 1, opp: 0, name: 'bottom' }, 
        { dc: -1, dr: 0, opp: 1, name: 'left' } 
    ];

    while(queue.length > 0) {
        const { col, row, outDir } = queue.shift();
        const offset = DIR_OFFSETS[outDir];
        const nc = col + offset.dc; 
        const nr = row + offset.dr;
        
        if (nc === destCol && nr === destRow) {
            return { connected: true, inPort: offset.opp };
        }

        const nextKey = `${nc},${nr}`;
        const nextNode = occupied.get(nextKey);
        
        if (nextNode && !nextNode.isDest) {
            const inDir = offset.opp;
            const inDirName = DIR_OFFSETS[inDir].name;
            
            if (nextNode[inDirName] === 1) {
                const inPort = `${nextKey},${inDir}`;
                if (!connectedPorts.has(inPort)) {
                    connectedPorts.add(inPort);
                    
                    const links = nextNode.internalLinks || [];
                    const myGroup = links.find(group => group.includes(inDir));
                    
                    if (myGroup) {
                        myGroup.forEach(outD => {
                            const outPort = `${nextKey},${outD}`;
                            if (!connectedPorts.has(outPort)) {
                                connectedPorts.add(outPort);
                                queue.push({ col: nc, row: nr, outDir: outD });
                            }
                        });
                    }
                }
            }
        }
    }
    return { connected: false };
}

function emitSaboUpdate(roomCode, room) {
    const now = Date.now();
    const safeRoom = { 
        ...room, 
        deckCount: room.deck ? room.deck.length : 0,
        timer: room.timer ? { 
            duration: room.timer.duration,
            remaining: Math.max(0, (room.timer.endTime - now) / 1000)
        } : null 
    };
    delete safeRoom.deck;
    delete safeRoom.goldRow;
    saboIo.to(roomCode).emit('roomUpdate', safeRoom);
}

function clearSaboTimer(room) {
    if (room.timer && room.timer.timeoutId) { 
        clearTimeout(room.timer.timeoutId); 
        room.timer.timeoutId = null; 
    }
    room.timer = null;
}

function startSaboTimer(room, roomCode, durationSec) {
    clearSaboTimer(room);
    const durationMs = durationSec * 1000;
    const endTime = Date.now() + durationMs;
    
    room.timer = {
        endTime: endTime,
        duration: durationSec,
        timeoutId: setTimeout(() => {
            if (room.timer && room.timer.endTime === endTime) {
                room.timer = null;
                autoPlaySaboTurn(room, roomCode);
            }
        }, durationMs)
    };
    emitSaboUpdate(roomCode, room);
}

function autoPlaySaboTurn(room, roomCode) {
    if (room.phase === 'WAIT_MAP_CONFIRM') {
        room.phase = 'GAME';
        const player = room.players.find(p => p.id === room.mapCheckData.actorId);
        if (player) {
            saboIo.to(roomCode).emit('actionAnnounce', { actionText: `시간 초과! 🗺️ ${player.name}님의 지도 확인이 강제로 종료됩니다.` });
        }
        saboIo.to(roomCode).emit('mapCheckDone', { row: room.mapCheckData.row });
        room.mapCheckData = null;
        
        if (checkSaboRoundEnd(room)) return;

        let loopCount = 0;
        do {
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            room.turnId = room.players[room.turnIndex].id;
            loopCount++;
        } while ((!room.players[room.turnIndex].hand || room.players[room.turnIndex].hand.length === 0) && loopCount < room.players.length);
        
        startSaboTimer(room, roomCode, 60);
        emitSaboUpdate(roomCode, room);
        return;
    }

    const player = room.players.find(p => p.id === room.turnId);
    if (player) {
        if (player.hand && player.hand.length > 0) {
            const randomIdx = Math.floor(Math.random() * player.hand.length);
            const discardCard = player.hand[randomIdx];
            
            let removedCount = 0;
            const idx = player.hand.findIndex(c => c.id === discardCard.id);
            if (idx !== -1) {
                player.hand.splice(idx, 1);
                removedCount++;
            }
            for (let i = 0; i < removedCount; i++) {
                if (room.deck && room.deck.length > 0) player.hand.push(room.deck.shift());
            }
        }
        saboIo.to(roomCode).emit('actionAnnounce', { actionText: `시간 초과! ${player.name}님의 턴이 강제로 넘어갑니다.` });
    }
    
    if (checkSaboRoundEnd(room)) return;

    let loopCount = 0;
    do {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        room.turnId = room.players[room.turnIndex].id;
        loopCount++;
    } while (
        (!room.players[room.turnIndex].hand || room.players[room.turnIndex].hand.length === 0) && 
        loopCount < room.players.length
    );
    startSaboTimer(room, roomCode, 60);
    emitSaboUpdate(roomCode, room);
}

function checkSaboRoundEnd(room) {
    const isDeckEmpty = !room.deck || room.deck.length === 0;
    const allHandsEmpty = room.players.every(p => !p.hand || p.hand.length === 0);
    if (isDeckEmpty && allHandsEmpty) {
        endSaboRound(room, false); 
        emitSaboUpdate(room.roomCode, room);
        return true;
    }
    return false;
}

function processThiefQueue(room, roomCode) {
    if (!room.thiefQueue || room.thiefQueue.length === 0) {
        room.currentThiefId = null; 
        emitSaboUpdate(roomCode, room);
        return;
    }

    room.currentThiefId = room.thiefQueue[0];
    const currentThief = room.players.find(p => p.id === room.currentThiefId);
    
    if (!currentThief || !currentThief.thief) {
        room.thiefQueue.shift();
        processThiefQueue(room, roomCode);
        return;
    }

    const validTargets = room.players.filter(p => p.id !== currentThief.id && p.gold > 0);
    
    if (validTargets.length === 0) {
        currentThief.thief = false;
        room.thiefQueue.shift();
        processThiefQueue(room, roomCode);
        return;
    }

    if (currentThief.isBot) {
        const target = validTargets[Math.floor(Math.random() * validTargets.length)];
        target.gold -= 1;
        currentThief.gold = (currentThief.gold || 0) + 1;
        currentThief.thief = false;
        
        saboIo.to(roomCode).emit('stealAnim', { 
            thiefId: currentThief.id || currentThief.userId, 
            victimId: target.id || target.userId 
        });

        saboIo.to(roomCode).emit('actionAnnounce', {
            actionText: `🦹 ${currentThief.name}님이 ${target.name}님의 금을 훔쳤습니다!`
        });
        
        room.thiefQueue.shift();
        setTimeout(() => {
            processThiefQueue(room, roomCode);
        }, 1500); 
        emitSaboUpdate(roomCode, room); 
    } else {
        emitSaboUpdate(roomCode, room);
    }
}

function endSaboRound(room, isMinerWin) {
    room.phase = 'ROUND_END';
    
    let greenWins = false;
    let blueWins = false;
    let peacefulWin = false;
    let actualMinerWin = isMinerWin;

    // 광부들이 금을 찾았다면, 출발점(2,4)에서 금덩이까지 경로를 추적하여 마지막 통과 문을 확인합니다.
    if (isMinerWin) {
        const destCol = 10;
        const destRow = room.goldRow;
        
        const occupied = new Map();
        occupied.set('2,4', { top: 1, right: 1, bottom: 1, left: 1, internalLinks: [[0,1,2,3]], imgCode: 'start' });
        
        room.board.forEach(c => {
            occupied.set(`${c.col},${c.row}`, { ...getCardEdges(c.imgCode, c.isRotated), imgCode: c.imgCode });
        });
        
        const connectedPorts = new Set();
        const queue = [];
        
        // 탐색 큐에는 현재까지 통과한 '가장 마지막 문' 정보를 같이 전달합니다 (기본: 'NONE')
        [0, 1, 2, 3].forEach(d => {
            connectedPorts.add(`2,4,${d}`);
            queue.push({ col: 2, row: 4, outDir: d, lastDoor: 'NONE' });
        });
        
        const DIR_OFFSETS = [ 
            { dc: 0, dr: -1, opp: 2, name: 'top' }, 
            { dc: 1, dr: 0, opp: 3, name: 'right' }, 
            { dc: 0, dr: 1, opp: 0, name: 'bottom' }, 
            { dc: -1, dr: 0, opp: 1, name: 'left' } 
        ];

        let winningDoor = null;

        while(queue.length > 0) {
            const { col, row, outDir, lastDoor } = queue.shift();
            const offset = DIR_OFFSETS[outDir];
            const nc = col + offset.dc; 
            const nr = row + offset.dr;
            
            // 금덩이에 도달했을 때, 가장 짧게 도달한 경로의 마지막 문 색상을 저장하고 종료
            if (nc === destCol && nr === destRow) {
                if (!winningDoor) winningDoor = lastDoor;
                break;
            }

            const nextKey = `${nc},${nr}`;
            const nextNode = occupied.get(nextKey);
            
            if (nextNode && !nextNode.isDest) {
                const inDir = offset.opp;
                const inDirName = DIR_OFFSETS[inDir].name;
                if (nextNode[inDirName] === 1) {
                    const inPort = `${nextKey},${inDir}`;
                    if (!connectedPorts.has(inPort)) {
                        connectedPorts.add(inPort);
                        
                        // 현재 지나가는 카드가 색깔 문이면 상태를 업데이트합니다.
                        let currentDoor = lastDoor;
                        if (['41','42','43'].includes(nextNode.imgCode)) currentDoor = 'GREEN';
                        else if (['44','45','46'].includes(nextNode.imgCode)) currentDoor = 'BLUE';

                        const links = nextNode.internalLinks || [];
                        const myGroup = links.find(group => group.includes(inDir));
                        if (myGroup) {
                            myGroup.forEach(outD => {
                                const outPort = `${nextKey},${outD}`;
                                if (!connectedPorts.has(outPort)) {
                                    connectedPorts.add(outPort);
                                    queue.push({ col: nc, row: nr, outDir: outD, lastDoor: currentDoor });
                                }
                            });
                        }
                    }
                }
            }
        }

        // 경로 추적 결과에 따라 승리 팀 판별
        if (winningDoor === 'GREEN') greenWins = true;
        else if (winningDoor === 'BLUE') blueWins = true;
        else if (winningDoor === 'NONE') peacefulWin = true;
        else actualMinerWin = false; // 도달할 수 없는 버그 엣지 케이스 방어
    }

    // [버그 수정] 보드에 깔린 수정(Crystal) 카드 개수 카운트
    const crystalCodes = ['31', '32', '33', '34', '35', '36', '37', '38'];
    let crystalCount = 0;
    if (room.board) {
        crystalCount = room.board.filter(c => crystalCodes.includes(c.imgCode)).length;
    }

    room.players.forEach(p => {
        const isPenalized = p.trapped; 
        let earnedGold = 0;
        
        if (!isPenalized) {
            if (actualMinerWin) {
                if (peacefulWin) {
                    if (['파란광부', '초록광부'].includes(p.role)) earnedGold = 2; // 평화 승리 시 양팀 2개
                    if (p.role === '대장') earnedGold = 1; // 2 - 1 = 1개
                } else if (greenWins) {
                    if (p.role === '초록광부') earnedGold = 3;
                    if (p.role === '대장') earnedGold = 2; // 3 - 1 = 2개
                } else if (blueWins) {
                    if (p.role === '파란광부') earnedGold = 3;
                    if (p.role === '대장') earnedGold = 2; // 3 - 1 = 2개
                }
                
                // 부당이익자는 광부 승리 시 항상 1개
                if (p.role === '부당이익자') earnedGold = 1;
                
            } else {
                // 방해꾼 승리 시 (광부 실패)
                if (p.role === '방해꾼') earnedGold = 3;
                if (p.role === '부당이익자') earnedGold = 1;
            }
            
            // [버그 수정] 지질학자는 맵(보드)에 연결된 수정 카드의 개수만큼 금 획득
            if (p.role === '지질학자') earnedGold = crystalCount;
        }
        
        p.gold = (p.gold || 0) + earnedGold;
    });

    const thieves = room.players.filter(p => p.thief);
    room.thiefQueue = thieves.map(t => t.id); 
    processThiefQueue(room, room.roomCode);
}

function startSaboRound(room) {
    room.phase = 'GAME';
    room.board = [];
    room.deck = createSaboDeck();
    room.deck.splice(0, 10); 
    
    room.goldRow = SABO_DEST_ROWS[Math.floor(Math.random() * SABO_DEST_ROWS.length)];
    
    const ALL_SABO_ROLES = [
        '파란광부', '파란광부', '파란광부', '파란광부', 
        '초록광부', '초록광부', '초록광부', '초록광부',
        '대장', '부당이익자', '지질학자', '지질학자', 
        '방해꾼', '방해꾼', '방해꾼'
    ];
    let roleDeck = [...ALL_SABO_ROLES].sort(() => Math.random() - 0.5);

    const handSize = room.players.length <= 5 ? 6 : 5;
    
    room.players.forEach(p => {
        p.role = roleDeck.pop() || '파란광부';
        p.hand = [];
        p.tools = { pickaxe: true, lantern: true, cart: true };
        p.thief = false;
        p.hasStolen = false; 
        p.trapped = false;
        p.earnedGoldThisRound = 0;
        
        for (let i = 0; i < handSize; i++) {
            if(room.deck.length > 0) p.hand.push(room.deck.shift());
        }
    });
    
    room.turnIndex = Math.floor(Math.random() * room.players.length);
    room.turnId = room.players[room.turnIndex].id;
}

const SABO_ACTION_CARD_IMAGES = {
    '수리_곡괭이_수레': 'https://masi4882.dothome.co.kr/sabo/51.jpg',
    '수리_곡괭이_랜턴': 'https://masi4882.dothome.co.kr/sabo/52.jpg',
    '수리_랜턴_수레': 'https://masi4882.dothome.co.kr/sabo/53.jpg',
    '도착점확인': 'https://masi4882.dothome.co.kr/sabo/54.jpg',
    '수리_랜턴': 'https://masi4882.dothome.co.kr/sabo/55.jpg',
    '수리_곡괭이': 'https://masi4882.dothome.co.kr/sabo/56.jpg',
    '수리_수레': 'https://masi4882.dothome.co.kr/sabo/57.jpg',
    '낙석': 'https://masi4882.dothome.co.kr/sabo/58.jpg',
    '파괴_곡괭이': 'https://masi4882.dothome.co.kr/sabo/59.jpg',
    '파괴_랜턴': 'https://masi4882.dothome.co.kr/sabo/60.jpg',
    '파괴_수레': 'https://masi4882.dothome.co.kr/sabo/61.jpg',
    '직업바꾸기': 'https://masi4882.dothome.co.kr/sabo/63.jpg',
    '염탐': 'https://masi4882.dothome.co.kr/sabo/64.jpg',
    '도둑': 'https://masi4882.dothome.co.kr/sabo/65.jpg',
    '도둑방지': 'https://masi4882.dothome.co.kr/sabo/66.jpg',
    '감옥': 'https://masi4882.dothome.co.kr/sabo/67.jpg',
    '감옥탈출': 'https://masi4882.dothome.co.kr/sabo/68.jpg'
};

function createSaboDeck() {
    const deck = [];
    let idCounter = 1;

    const addPathCards = (imgCode, count, type, desc) => {
        for (let i = 0; i < count; i++) {
            deck.push({ id: `c${idCounter++}`, type: type, desc: desc, imgCode: imgCode, isPlayable: true });
        }
    };

    addPathCards('03', 4, 'path', '일반 길'); addPathCards('04', 3, 'path', '일반 길');
    addPathCards('05', 5, 'path', '일반 길'); addPathCards('06', 4, 'path', '일반 길');
    addPathCards('07', 5, 'path', '일반 길'); addPathCards('08', 5, 'path', '일반 길');
    addPathCards('09', 5, 'path', '일반 길');
    
    const singlePathCodes = ['10','11','12','13','14','15','16','17','18','21','22','23','24','25','26','27','28'];
    singlePathCodes.forEach(code => addPathCards(code, 1, 'path', '일반 길'));

    addPathCards('29', 2, 'path', '터널 길 (연결됨)');

    const singleCrystalCodes = ['31','32','33','34','36','37','38'];
    singleCrystalCodes.forEach(code => addPathCards(code, 1, 'path', '수정 길'));
    addPathCards('35', 3, 'path', '수정 길');

    ['41','42','43'].forEach(code => addPathCards(code, 1, 'path', '초록문 길'));
    ['44','45','46'].forEach(code => addPathCards(code, 1, 'path', '파란문 길'));
    ['47','48','49','50'].forEach(code => addPathCards(code, 1, 'path', '사다리 길 (시작점)'));

    const addAction = (desc, imgKey, count) => {
        for (let i = 0; i < count; i++) {
            deck.push({ id: `c${idCounter++}`, type: 'action', desc: desc, img: imgKey ? SABO_ACTION_CARD_IMAGES[imgKey] : null, isPlayable: true });
        }
    };

    addAction('곡괭이 파괴', '파괴_곡괭이', 3); addAction('랜턴 파괴', '파괴_랜턴', 3); addAction('수레 파괴', '파괴_수레', 3);
    addAction('곡괭이 수리', '수리_곡괭이', 2); addAction('랜턴 수리', '수리_랜턴', 2); addAction('수레 수리', '수리_수레', 2);
    addAction('곡괭이/수레 수리', '수리_곡괭이_수레', 1); addAction('곡괭이/랜턴 수리', '수리_곡괭이_랜턴', 1); addAction('랜턴/수레 수리', '수리_랜턴_수레', 1);
    addAction('도착점 확인', '도착점확인', 6); addAction('낙석', '낙석', 3); addAction('도둑', '도둑', 4);
    addAction('도둑 방지', '도둑방지', 3); addAction('감옥', '감옥', 3); addAction('감옥 탈출', '감옥탈출', 4);
    addAction('직업 바꾸기', '직업바꾸기', 2); addAction('염탐', '염탐', 2);

    return deck.sort(() => Math.random() - 0.5); 
}

saboIo.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    
    socket.on('actionCardAnimSync', (data) => {
        try {
            saboIo.to(data.roomCode).emit('actionCardAnimSync', data);
        } catch(e) {
            console.error('Sabo actionCardAnimSync error:', e);
        }
    });

    socket.on('stealGold', ({ roomCode, targetId }) => {
        try {
            const room = saboRooms[roomCode];
            if (!room) return;

            if (room.currentThiefId !== socket.id) return;

            const thiefPlayer = room.players.find(p => p.id === socket.id);
            const targetPlayer = room.players.find(p => p.id === targetId || p.userId === targetId);

            if (!thiefPlayer || !targetPlayer) return;

            if (thiefPlayer.thief && targetPlayer.gold > 0) {
                targetPlayer.gold -= 1;
                thiefPlayer.gold = (thiefPlayer.gold || 0) + 1;
                thiefPlayer.thief = false; 

                saboIo.to(roomCode).emit('stealAnim', { 
                    thiefId: thiefPlayer.id || thiefPlayer.userId, 
                    victimId: targetPlayer.id || targetPlayer.userId 
                });

                saboIo.to(roomCode).emit('actionAnnounce', {
                    actionText: `🦹 ${thiefPlayer.name}님이 ${targetPlayer.name}님의 금을 훔쳤습니다!`
                });

                if (room.thiefQueue && room.thiefQueue.length > 0) {
                    room.thiefQueue.shift();
                    processThiefQueue(room, roomCode);
                } else {
                    emitSaboUpdate(roomCode, room);
                }
            }
        } catch (error) { console.error("Steal Gold Error:", error); }
    });

    socket.on('skipSteal', ({ roomCode }) => {
        try {
            const room = saboRooms[roomCode];
            if (!room) return;
            
            if (room.currentThiefId !== socket.id) return;

            const thiefPlayer = room.players.find(p => p.id === socket.id);
            if (thiefPlayer && thiefPlayer.thief) {
                thiefPlayer.thief = false;
                saboIo.to(roomCode).emit('actionAnnounce', {
                    actionText: `🦹 ${thiefPlayer.name}님이 금 훔치기를 건너뛰었습니다.`
                });
            }

            if (room.thiefQueue && room.thiefQueue.length > 0) {
                room.thiefQueue.shift();
                processThiefQueue(room, roomCode);
            } else {
                emitSaboUpdate(roomCode, room);
            }
        } catch (error) { console.error("Skip Steal Error:", error); }
    });
    
    socket.on('mapCheckDone', ({ roomCode, row }) => {
        try {
            const room = saboRooms[roomCode];
            if (!room) return;

            saboIo.to(roomCode).emit('mapCheckDone', { row });

            if (room.phase === 'WAIT_MAP_CONFIRM' && room.mapCheckData && room.mapCheckData.actorId === socket.id) {
                room.phase = 'GAME';
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    saboIo.to(roomCode).emit('actionAnnounce', { actionText: `🗺️ ${player.name}님이 지도 확인을 완료했습니다.` });
                }
                room.mapCheckData = null;

                if (checkSaboRoundEnd(room)) return;

                let loopCount = 0;
                do {
                    room.turnIndex = (room.turnIndex + 1) % room.players.length;
                    room.turnId = room.players[room.turnIndex].id;
                    loopCount++;
                } while ((!room.players[room.turnIndex].hand || room.players[room.turnIndex].hand.length === 0) && loopCount < room.players.length);
                
                startSaboTimer(room, roomCode, 60);
                emitSaboUpdate(roomCode, room);
            }
        } catch(e) { console.error(e); }
    });

    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!saboRooms[roomCode]) {
                saboRooms[roomCode] = { 
                    roomCode, phase: 'LOBBY', round: 1, maxRound: 3, 
                    players: [], spectators: [], timeouts: new Set(),
                    turnIndex: 0, board: [], timer: null, deck: [], goldRow: null
                };
            }
            const room = saboRooms[roomCode];

            const disconnectKey = `${roomCode}_${userId}`;
            if (saboDisconnectTimers[disconnectKey]) {
                clearTimeout(saboDisconnectTimers[disconnectKey]);
                delete saboDisconnectTimers[disconnectKey];
            }

            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || p.name === userName);
            if (!existingPlayer) {
                const isSpectator = room.phase !== 'LOBBY';
                room.players.push({
                    id: socket.id, name: userName, userId, isBot, ready: room.players.length === 0, 
                    gold: 0, tools: { pickaxe: true, lantern: true, cart: true }, thief: false, trapped: false,
                    hasStolen: false, hand: [], connected: true, isSpectator
                });
            } else {
                const oldId = existingPlayer.id;
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;

                if (room.turnId === oldId) room.turnId = socket.id;
                
                if (room.currentThiefId === oldId) room.currentThiefId = socket.id;
                if (room.thiefQueue) room.thiefQueue = room.thiefQueue.map(id => id === oldId ? socket.id : id);
            }
            emitSaboUpdate(roomCode, room);
        } catch(e) {}
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = saboRooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; emitSaboUpdate(roomCode, room); }
            }
        } catch(e) {}
    });

    socket.on('startGame', (roomCode) => {
        try {
            const room = saboRooms[roomCode];
            if (!room || room.players.length === 0) return;
            
            room.round = 1;
            room.players.forEach(p => { p.gold = 0; });
            
            startSaboRound(room);
            saboIo.to(roomCode).emit('gameStarted', room);
            startSaboTimer(room, roomCode, 60);

        } catch(e) {}
    });

    socket.on('nextRound', (roomCode) => {
        try {
            const room = saboRooms[roomCode];
            if (room && room.players[0].id === socket.id && room.phase === 'ROUND_END') {
                room.round++;
                if (room.round > room.maxRound) {
                    room.phase = 'GAME_OVER';
                    emitSaboUpdate(roomCode, room);
                } else {
                    startSaboRound(room);
                    saboIo.to(roomCode).emit('gameStarted', room);
                    startSaboTimer(room, roomCode, 60);
                }
            }
        } catch(e) {}
    });

    socket.on('playCard', ({ roomCode, card, cards, discardIds, targetId, slot, isRotated, isDiscard, equipType }) => {
        try {
            const room = saboRooms[roomCode];
            if (!room || room.phase !== 'GAME') return;

            const player = room.players.find(p => p.id === socket.id);
            if (!player || room.turnId !== socket.id) return; 

            clearSaboTimer(room);
            let actionText = `${player.name}님이 카드를 사용했습니다.`;
            let turnWillEnd = true; 

            if (isDiscard) {
                let idsToRemove = [];
                if (discardIds && Array.isArray(discardIds) && discardIds.length > 0) {
                    idsToRemove = discardIds;
                } else if (cards && Array.isArray(cards) && cards.length > 0) {
                    idsToRemove = cards.map(c => c.id);
                } else if (card && card.id) {
                    idsToRemove = [card.id];
                }

                if (idsToRemove.length > 0) {
                    let removedCount = 0;
                    player.hand = player.hand.filter(c => {
                        if (idsToRemove.includes(c.id)) {
                            removedCount++;
                            return false;
                        }
                        return true;
                    });
                    
                    for (let i = 0; i < removedCount; i++) {
                        if (room.deck && room.deck.length > 0) {
                            player.hand.push(room.deck.shift());
                        }
                    }
                    actionText = `${player.name}님이 카드를 버렸습니다.`;
                } else {
                    actionText = `${player.name}님이 턴을 넘겼습니다.`;
                }
                saboIo.to(roomCode).emit('actionAnnounce', { actionText });
            } else {
                if (card) {
                    const target = targetId ? room.players.find(p => p.id === targetId || p.userId === targetId) : null;
                    const d = (card.desc || '').replace(/\s+/g, '');

                    if (target) {
                        if (d.includes('파괴') || d.includes('수리')) {
                            let eqName = '장비';
                            if (equipType === 'pickaxe') eqName = '곡괭이';
                            else if (equipType === 'lantern') eqName = '랜턴';
                            else if (equipType === 'cart') eqName = '수레';
                            else {
                                let parts = [];
                                if (d.includes('곡괭이')) parts.push('곡괭이');
                                if (d.includes('랜턴')) parts.push('랜턴');
                                if (d.includes('수레')) parts.push('수레');
                                if (parts.length > 0) eqName = parts.join('/');
                            }

                            if (d.includes('파괴')) {
                                if (equipType) target.tools[equipType] = false;
                                else { if (d.includes('곡괭이')) target.tools.pickaxe = false; if (d.includes('랜턴')) target.tools.lantern = false; if (d.includes('수레')) target.tools.cart = false; }
                                actionText = `💥 ${player.name}님이 ${target.name}의 (${eqName})을(를) 파괴했습니다!`;
                            } else if (d.includes('수리')) {
                                if (equipType) target.tools[equipType] = true;
                                else { if (d.includes('곡괭이')) target.tools.pickaxe = true; if (d.includes('랜턴')) target.tools.lantern = true; if (d.includes('수레')) target.tools.cart = true; }
                                actionText = `🔧 ${player.name}님이 ${target.name}의 (${eqName})을(를) 고쳐주었습니다!`;
                            }
                        }
                        else if (d.includes('염탐') || d.includes('정보확인')) { 
                            saboIo.to(socket.id).emit('spyResult', { targetName: target.name, role: target.role, targetId: target.id || target.userId }); 
                            actionText = `🕵️ ${player.name}님이 누군가를 염탐했습니다.`;
                        } 
                        else if (d.includes('직업바꾸기') || d.includes('직업교체') || d.includes('모자교환')) {
                            const ROLES = ['파란광부', '초록광부', '대장', '부당이익자', '지질학자', '방해꾼'];
                            target.role = ROLES[Math.floor(Math.random() * ROLES.length)];
                            actionText = `🔄 ${player.name}님이 ${target.name}의 직업을 바꿨습니다!`;
                        }
                        else if (d.includes('도둑방지') || d.includes('도둑막기') || d.includes('도둑잡기')) {
                            target.thief = false;
                            actionText = `👮 ${target.name}의 도둑질이 차단되었습니다!`;
                        }
                        else if (d.includes('도둑')) {
                            if (player.thief) return;
                            player.thief = true;
                            actionText = `🦹 ${player.name}님이 도둑질을 준비합니다.`;
                        }
                        else if (d.includes('감옥탈출') || d.includes('탈옥') || d.includes('감옥해방')) {
                            target.trapped = false;
                            actionText = `🕊️ ${target.name}님이 감옥에서 풀려났습니다!`;
                        }
                        else if (d.includes('감옥') && !d.includes('탈출')) {
                            target.trapped = true;
                            actionText = `⛓️ ${target.name}님이 감옥에 갇혔습니다!`;
                        }
                    } else if (slot) {
                        if (d.includes('낙석') || d.includes('붕괴') || d.includes('길파괴')) {
                            const bIdx = room.board.findIndex(c => c.col === slot.col && c.row === slot.row);
                            if (bIdx !== -1) {
                                saboIo.to(roomCode).emit('rockfallAnim', { col: slot.col, row: slot.row, imgCode: room.board[bIdx].imgCode });
                                room.board.splice(bIdx, 1);
                            }
                            actionText = `🪨 ${player.name}님이 낙석을 일으켰습니다!`;
                        } else if (d.includes('지도') || d.includes('도착') || d.includes('확인')) {
                            
                            saboIo.to(roomCode).emit('mapCheckAnim', { col: slot.col, row: slot.row, actorId: player.id });
                            const isGold = (slot.row === room.goldRow);
                            saboIo.to(socket.id).emit('mapCheckResult', { row: slot.row, type: isGold ? 'gold' : 'coal' });
                            actionText = `🗺️ ${player.name}님이 지도를 은밀하게 확인중입니다...`;
                            
                            let removedCount = 0;
                            const idx = player.hand.findIndex(c => c.id === card.id);
                            if (idx !== -1) {
                                player.hand.splice(idx, 1);
                                removedCount++;
                            }
                            for (let i = 0; i < removedCount; i++) {
                                if (room.deck && room.deck.length > 0) player.hand.push(room.deck.shift());
                            }
                            
                            saboIo.to(roomCode).emit('actionAnnounce', { actionText });

                            room.phase = 'WAIT_MAP_CONFIRM';
                            room.mapCheckData = { actorId: player.id, row: slot.row };
                            turnWillEnd = false; 
                            
                            if (player.isBot) {
                                setTimeout(() => {
                                    const r = saboRooms[roomCode];
                                    if (r && r.phase === 'WAIT_MAP_CONFIRM' && r.mapCheckData?.actorId === player.id) {
                                        r.phase = 'GAME';
                                        saboIo.to(roomCode).emit('actionAnnounce', { actionText: `🗺️ ${player.name}님이 지도 확인을 완료했습니다.` });
                                        saboIo.to(roomCode).emit('mapCheckDone', { row: r.mapCheckData.row });
                                        r.mapCheckData = null;
                                        if (checkSaboRoundEnd(r)) return;
                                        let lc = 0;
                                        do {
                                            r.turnIndex = (r.turnIndex + 1) % r.players.length;
                                            r.turnId = r.players[r.turnIndex].id;
                                            lc++;
                                        } while ((!r.players[r.turnIndex].hand || r.players[r.turnIndex].hand.length === 0) && lc < r.players.length);
                                        startSaboTimer(r, roomCode, 60);
                                        emitSaboUpdate(roomCode, r);
                                    }
                                }, 3000);
                            } else {
                                startSaboTimer(room, roomCode, 15); 
                            }
                            emitSaboUpdate(roomCode, room);
                            
                        } else if (card.type === 'path') {
                            saboIo.to(roomCode).emit('pathCardAnim', { col: slot.col, row: slot.row, imgCode: card.imgCode, isRotated: isRotated || false, actorId: player.id });
                            
                            if (!room.board) room.board = [];
                            room.board.push({ id: card.id, type: card.type, desc: card.desc, imgCode: card.imgCode, col: slot.col, row: slot.row, isRotated: isRotated || false });
                            actionText = `${player.name}님이 길을 개척했습니다!`;

                            for (const targetRow of SABO_DEST_ROWS) {
                                if (!room.board.find(b => b.col === 10 && b.row === targetRow)) {
                                    const destCheck = isDestConnectedToStart(room.board, 10, targetRow);
                                    
                                    if (destCheck && destCheck.connected) {
                                        const isGold = (targetRow === room.goldRow);
                                        
                                        const shouldRotate = !isGold && (destCheck.inPort === 1 || destCheck.inPort === 2);
                                        
                                        room.board.push({ col: 10, row: targetRow, imgCode: isGold ? '01' : '02', isRotated: shouldRotate });
                                        
                                        if (isGold) {
                                            saboIo.to(roomCode).emit('actionAnnounce', { actionText: `🎉 ${player.name}님이 금덩이를 발견했습니다!` });
                                            
                                            let removedCount = 0;
                                            const idx = player.hand.findIndex(c => c.id === card.id);
                                            if (idx !== -1) { player.hand.splice(idx, 1); removedCount++; }
                                            for (let i = 0; i < removedCount; i++) {
                                                if (room.deck && room.deck.length > 0) player.hand.push(room.deck.shift());
                                            }

                                            const canGreenReach = isDestConnectedToStart(room.board, 10, targetRow, ['44','45','46']);
                                            const canBlueReach = isDestConnectedToStart(room.board, 10, targetRow, ['41','42','43']);

                                            let pathType = 'NORMAL';
                                            if (canGreenReach && !canBlueReach) pathType = 'GREEN';
                                            else if (canBlueReach && !canGreenReach) pathType = 'BLUE';
                                            else if (!canGreenReach && !canBlueReach) pathType = 'NONE';
                                            else pathType = 'NORMAL';

                                            room.winPathType = pathType;
                                            room.phase = 'REVEALING_GOLD'; 
                                            clearSaboTimer(room);
                                            turnWillEnd = false; 
                                            emitSaboUpdate(roomCode, room);
                                            
                                            setTimeout(() => {
                                                const curRoom = saboRooms[roomCode];
                                                if (curRoom && curRoom.phase === 'REVEALING_GOLD') {
                                                    const isMinerWin = curRoom.winPathType !== 'NONE';
                                                    endSaboRound(curRoom, isMinerWin, curRoom.winPathType);
                                                    emitSaboUpdate(roomCode, curRoom);
                                                }
                                            }, 4000);
                                        } else {
                                            actionText = `앗! 석탄이었습니다.`;
                                            saboIo.to(roomCode).emit('mapCheckResult', { row: targetRow, type: 'coal' });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    if (turnWillEnd) {
                        let removedCount = 0;
                        const idx = player.hand.findIndex(c => c.id === card.id);
                        if (idx !== -1) {
                            player.hand.splice(idx, 1);
                            removedCount++;
                        }
                        for (let i = 0; i < removedCount; i++) {
                            if (room.deck && room.deck.length > 0) player.hand.push(room.deck.shift());
                        }
                        saboIo.to(roomCode).emit('actionAnnounce', { actionText });
                    }
                }
            }

            if (turnWillEnd) {
                if (checkSaboRoundEnd(room)) {
                    return;
                }

                let loopCount = 0;
                do {
                    room.turnIndex = (room.turnIndex + 1) % room.players.length;
                    room.turnId = room.players[room.turnIndex].id;
                    loopCount++;
                } while ((!room.players[room.turnIndex].hand || room.players[room.turnIndex].hand.length === 0) && loopCount < room.players.length);
                
                startSaboTimer(room, roomCode, 60);
                emitSaboUpdate(roomCode, room);
            }

        } catch(e) { console.error(e); }
    });

    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = saboRooms[roomCode]; if (!room) return;
            if (room.players.length > 0 && room.players[0].id === socket.id && room.players.some(p => p.isBot)) { destroyRoom(saboRooms, saboDisconnectTimers, roomCode, saboIo, '방장이 퇴장하여 방이 폭파되었습니다.'); return; }
            
            const wasTheirTurn = room.turnId === socket.id;
            
            if (room.phase === 'WAIT_MAP_CONFIRM' && room.mapCheckData?.actorId === socket.id) {
                room.phase = 'GAME';
                saboIo.to(roomCode).emit('mapCheckDone', { row: room.mapCheckData.row });
                room.mapCheckData = null;
                if (checkSaboRoundEnd(room)) return;
                let loopCount = 0;
                do {
                    room.turnIndex = (room.turnIndex + 1) % room.players.length;
                    room.turnId = room.players[room.turnIndex].id;
                    loopCount++;
                } while ((!room.players[room.turnIndex].hand || room.players[room.turnIndex].hand.length === 0) && loopCount < room.players.length);
                startSaboTimer(room, roomCode, 60);
            }

            room.players = room.players.filter(p => p.id !== socket.id); 
            socket.leave(roomCode);
            
            if (room.players.length === 0) { destroyRoom(saboRooms, saboDisconnectTimers, roomCode, saboIo); } 
            else {
                if (room.phase === 'GAME') {
                    if (wasTheirTurn) { room.turnIndex = room.turnIndex % room.players.length; room.turnId = room.players[room.turnIndex].id; startSaboTimer(room, roomCode, 60); } 
                    else {
                        const currentTurnPlayer = room.players.find(p => p.id === room.turnId);
                        if (currentTurnPlayer) { room.turnIndex = room.players.findIndex(p => p.id === room.turnId); } 
                        else { room.turnIndex = 0; room.turnId = room.players[0].id; }
                    }
                }
                emitSaboUpdate(roomCode, room);
            }
        } catch(e){}
    });

    socket.on('disconnect', () => {
        try {
            for (let roomCode in saboRooms) {
                const room = saboRooms[roomCode]; const playerIndex = room.players.findIndex(p => p.id === socket.id);
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];
                    if (playerIndex === 0 && room.players.some(p => p.isBot)) { destroyRoom(saboRooms, saboDisconnectTimers, roomCode, saboIo, '방장의 연결이 끊겨 방이 폭파되었습니다.'); continue; }
                    player.connected = false; const disconnectKey = `${roomCode}_${player.userId}`;
                    if (saboDisconnectTimers[disconnectKey]) clearTimeout(saboDisconnectTimers[disconnectKey]);
                    if (room.phase === 'LOBBY') {
                        room.players.splice(playerIndex, 1);
                        if (room.players.length === 0) { destroyRoom(saboRooms, saboDisconnectTimers, roomCode, saboIo); } else { emitSaboUpdate(roomCode, room); }
                    } else {
                        emitSaboUpdate(roomCode, room);
                        saboDisconnectTimers[disconnectKey] = setTimeout(() => {
                            delete saboDisconnectTimers[disconnectKey]; const currentRoom = saboRooms[roomCode]; if (!currentRoom) return;
                            const wasTheirTurn = currentRoom.turnId === player.id; currentRoom.players = currentRoom.players.filter(p => p.userId !== player.userId);
                            
                            if (currentRoom.phase === 'WAIT_MAP_CONFIRM' && currentRoom.mapCheckData?.actorId === player.id) {
                                currentRoom.phase = 'GAME';
                                saboIo.to(roomCode).emit('mapCheckDone', { row: currentRoom.mapCheckData.row });
                                currentRoom.mapCheckData = null;
                                if (checkSaboRoundEnd(currentRoom)) return;
                                let loopCount = 0;
                                do {
                                    currentRoom.turnIndex = (currentRoom.turnIndex + 1) % currentRoom.players.length;
                                    currentRoom.turnId = currentRoom.players[currentRoom.turnIndex].id;
                                    loopCount++;
                                } while ((!currentRoom.players[currentRoom.turnIndex].hand || currentRoom.players[currentRoom.turnIndex].hand.length === 0) && loopCount < currentRoom.players.length);
                                startSaboTimer(currentRoom, roomCode, 60);
                            }

                            if (currentRoom.players.length === 0) { destroyRoom(saboRooms, saboDisconnectTimers, roomCode, saboIo); } 
                            else {
                                if (currentRoom.phase === 'GAME') {
                                    if (wasTheirTurn) { currentRoom.turnIndex = currentRoom.turnIndex % currentRoom.players.length; currentRoom.turnId = currentRoom.players[currentRoom.turnIndex].id; startSaboTimer(currentRoom, roomCode, 60); } 
                                    else { const currentTurnPlayer = currentRoom.players.find(p => p.id === currentRoom.turnId); if (currentTurnPlayer) { currentRoom.turnIndex = currentRoom.players.findIndex(p => p.id === currentRoom.turnId); } else { currentRoom.turnIndex = 0; currentRoom.turnId = currentRoom.players[0].id; } }
                                }
                                emitSaboUpdate(roomCode, currentRoom);
                            }
                        }, 60000); 
                    }
                }
            }
        } catch(e) {}
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { 
    console.log(`🚀 포커, 플립7, COUP, 사보타지 서버 구동 완료. 포트 ${PORT}`); 
});
