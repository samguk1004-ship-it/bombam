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

pokerIo.on('connection', (socket) => {
    socket.on('pingHeartbeat', () => { socket.emit('pongHeartbeat'); });
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
            socket.join(roomCode);
            if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], spectators: [], timers: {}, paused: false };
            const room = pokerRooms[roomCode];
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            
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
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('leaveRoom', (roomCode) => {});
    socket.on('disconnect', () => {});
});


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
            if (!existingPlayer) {
                room.players.push({ id: socket.id, userId, name: userName, isBot, ready: room.players.length === 0, score: 0, connected: true });
            } else {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
            }
            flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) {}
    });
    socket.on('leaveRoom', (roomCode) => {});
    socket.on('disconnect', () => {});
});


// ==========================================
// 🗡️ [3] 쿠 전용 (Namespace: /coup)
// ==========================================
const coupIo = io.of('/coup');
const coupRooms = {};
const coupDisconnectTimers = {}; // 1분 이내 재접속 유예 타이머 관리 맵

function emitCoupUpdate(roomCode, room) {
    const safeRoom = {
        ...room,
        timer: room.timer ? { endTime: room.timer.endTime, duration: room.timer.duration } : null
    };
    coupIo.to(roomCode).emit('roomUpdate', safeRoom);
}

function clearCoupTimer(room) {
    if (room.timer && room.timer.timeoutId) {
        clearTimeout(room.timer.timeoutId);
        room.timer.timeoutId = null;
    }
    room.timer = null;
}

function startCoupTimer(room, roomCode, durationSec, callback) {
    clearCoupTimer(room);
    const durationMs = durationSec * 1000;
    const endTime = Date.now() + durationMs;
    
    room.timer = {
        endTime: endTime,
        duration: durationSec,
        timeoutId: setTimeout(() => {
            if (room.timer && room.timer.endTime === endTime) {
                room.timer = null;
                callback();
            }
        }, durationMs)
    };
    emitCoupUpdate(roomCode, room);
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
    
    const activePlayers = room.players.filter(p => !p.isDead);
    if (activePlayers.length <= 1) return;

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
    const targetId = room.actionState.targetId;
    const targetPlayer = room.players.find(p => p.id === targetId);

    if ((room.actionState.type === 'CAPTAIN' || room.actionState.type === 'ASSASSIN') && targetPlayer && !targetPlayer.isDead && !room.actionState.askedList.includes(targetPlayer.id)) {
        room.actionState.currentPromptId = targetPlayer.id;
        startCoupTimer(room, roomCode, 30, () => {
            const curRoom = coupRooms[roomCode];
            if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_BLOCK') return;
            const promptP = curRoom.players.find(p => p.id === curRoom.actionState.currentPromptId);
            if (promptP) {
                processBlockResponse(curRoom, roomCode, promptP.id, false);
            }
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
            if (promptP) {
                processBlockResponse(curRoom, roomCode, promptP.id, false);
            }
        });
        emitCoupUpdate(roomCode, room);
    } else {
        clearCoupTimer(room);
        const actor = room.players.find(p => p.id === room.actionState.actorId);
        const target = room.players.find(p => p.id === room.actionState.targetId);
        if (actor) {
            if (room.actionState.type === 'FOREIGN_AID') {
                actor.coins += 2;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '해외 원조를 성공적으로 받아 +2코인을 획득했습니다.' });
            } else if (room.actionState.type === 'DUKE') {
                actor.coins += 3;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '징세를 성공하여 +3코인을 획득했습니다.' });
            } else if (room.actionState.type === 'ASSASSIN') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '암살에 성공했습니다.' });
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
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `강탈에 성공하여 ${stealAmount}코인을 훔쳤습니다.` });
            }
        }
        room.actionState = null;
        nextTurnCoup(room, roomCode);
    }
    emitCoupUpdate(roomCode, room);
}

function processBlockResponse(room, roomCode, playerId, block, blockRole) {
    clearCoupTimer(room);
    const actor = room.players.find(p => p.id === room.actionState.actorId);

    if (block) { 
        room.actionState.blockerId = playerId;
        room.actionState.blockRole = blockRole || (room.actionState.type === 'ASSASSIN' ? '귀부인' : '사령관');
        
        room.actionState.phase = 'WAIT_CHALLENGE';
        emitCoupUpdate(roomCode, room);
        startCoupTimer(room, roomCode, 30, () => {
            const curRoom = coupRooms[roomCode];
            if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_CHALLENGE') return;
            const actorP = curRoom.players.find(p => p.id === curRoom.actionState.actorId);
            if (actorP) {
                processChallengeResponse(curRoom, roomCode, actorP.id, false);
            }
        });
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
            } else {
                const targetP = room.players.find(p => p.id === room.actionState.targetId);
                const stealAmount = Math.min(2, targetP ? targetP.coins : 0);
                if (targetP) targetP.coins -= stealAmount;
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
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    const actorName = actor ? actor.name : '';

    if (challenge) { 
        room.actionState.phase = 'REVEAL_CARD';
        room.actionState.revealerId = room.actionState.blockerId;
        
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
        if (room.actionState.type === 'CAPTAIN') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '강탈에 실패하였습니다.' });
        } else {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '행동에 실패하였습니다.' });
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
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    const actorName = actor ? actor.name : '';
    
    let isSuccess = false;
    if (actionType === 'ASSASSIN_BLOCK_CHALLENGE') {
        isSuccess = (card.role === '귀부인');
    } else if (actionType === 'CAPTAIN_BLOCK_CHALLENGE' || actionType === 'CAPTAIN') {
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
        const currentActor = currentRoom.players.find(p => p.id === currentRoom.actionState?.actorId);
        const curActorName = currentActor ? currentActor.name : '';

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
        } else if (curActionType === 'ASSASSIN_BLOCK_CHALLENGE' || curActionType === 'CAPTAIN_BLOCK_CHALLENGE' || curActionType === 'CAPTAIN') {
            if (isSuccess) {
                const matchedRole = currentCard.role;
                currentRoom.deck.push(matchedRole);
                currentRoom.deck.sort(() => Math.random() - 0.5);
                currentCard.role = currentRoom.deck.pop();
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '강탈에 실패하였습니다.' });
                
                currentRoom.actionState = null;
                nextTurnCoup(currentRoom, currentRoom);
                emitCoupUpdate(currentRoom, currentRoom);
                return;
            } else {
                currentCard.alive = false;
                if (!currentRevealer.influence.some(c => c.alive)) currentRevealer.isDead = true;
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '강탈 방어 실패! 강탈에 성공했습니다.' });
                
                if (curActionType === 'CAPTAIN_BLOCK_CHALLENGE' || curActionType === 'CAPTAIN') {
                    const target = currentRoom.players.find(p => p.id === currentRoom.actionState.targetId);
                    const stealAmount = Math.min(2, target ? target.coins : 0);
                    if (target) target.coins -= stealAmount;
                    currentActor.coins += stealAmount;
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

            const disconnectKey = `${roomCode}_${userId}`;
            if (coupDisconnectTimers[disconnectKey]) {
                clearTimeout(coupDisconnectTimers[disconnectKey]);
                delete coupDisconnectTimers[disconnectKey];
            }

            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || p.name === userName);
            
            if (!existingPlayer) {
                // 게임 중 새로 참여하는 유저는 관전 또는 대기 상태로 처리 방지 (게임 중 튕겼다 재접속 시 유예 기간 내에 기존 데이터 매칭)
                room.players.push({
                    id: socket.id, name: userName, userId, isBot, ready: room.players.length === 0,
                    coins: 2, influence: [], isDead: false, connected: true
                });
            } else {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
                existingPlayer.isReconnecting = false;
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

            if (action === 'CAPTAIN' && target) {
                room.actionState = { phase: 'ANNOUNCING' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${actor.name}님이 ${target.name}님을 강탈합니다.` });
                setTimeout(() => {
                    const currentRoom = coupRooms[roomCode];
                    if (!currentRoom) return;
                    currentRoom.actionState = { type: 'CAPTAIN', actorId: actor.id, targetId: target.id, askedList: [], phase: 'WAIT_BLOCK' };
                    setNextBlocker(currentRoom, currentRoom);
                }, 1500);
                return;
            }

            if (action === 'INCOME') {
                actor.coins += 1;
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '소득으로 +1코인을 획득했습니다.' });
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
            } else if (action === 'ASSASSIN' && target) {
                actor.coins -= 3;
                room.actionState = { type: 'ASSASSIN', actorId: actor.id, targetId: target.id, askedList: [], phase: 'WAIT_BLOCK' };
                setNextBlocker(room, roomCode);
                return;
            } else if (action === 'COUP' && target) {
                actor.coins -= 7;
                room.actionState = { type: 'COUP', actorId: actor.id, revealerId: target.id, phase: 'REVEAL_CARD' };
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
                return;
            } else if (action === 'AMBASSADOR') {
                const aliveCards = actor.influence.filter(c => c.alive).map(c => c.role);
                const drawn1 = room.deck.pop();
                const drawn2 = room.deck.pop();
                const allFour = [...aliveCards, drawn1, drawn2];
                room.tempAmbassadorCards = { playerId: actor.id, drawnCards: allFour };
                
                room.actionState = { type: 'AMBASSADOR', actorId: actor.id, phase: 'WAIT_AMBASSADOR' };
                coupIo.to(socket.id).emit('startAmbassadorAnim', { actorId: actor.id, drawnCards: allFour });
                
                startCoupTimer(room, roomCode, 30, () => {
                    const curRoom = coupRooms[roomCode];
                    if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_AMBASSADOR') return;
                    const p = curRoom.players.find(pl => pl.id === actor.id);
                    if (p) {
                        curRoom.actionState = null;
                        nextTurnCoup(curRoom, roomCode);
                        emitCoupUpdate(curRoom, curRoom);
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
        } catch(e) {}
    });

    socket.on('ambassadorChosen', ({ roomCode, keepIndices, returnIndices }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_AMBASSADOR' || room.actionState.actorId !== socket.id) return;
            
            clearCoupTimer(room);
            const player = room.players.find(p => p.id === socket.id);
            if (!player || !room.tempAmbassadorCards) return;

            const allCards = room.tempAmbassadorCards.drawnCards;
            const keptRoles = keepIndices.map(idx => allCards[idx]);
            const returnedRoles = returnIndices.map(idx => allCards[idx]);

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

            coupIo.to(roomCode).emit('actionAnnounce', { actorName: player.name, actionText: '카드를 교환하였습니다.' });
            nextTurnCoup(room, roomCode);
            emitCoupUpdate(roomCode, room);
        } catch(e) {}
    });

    socket.on('blockResponse', ({ roomCode, block, blockRole }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_BLOCK' || room.actionState.currentPromptId !== socket.id) return;
            
            if (room.actionState.type === 'ASSASSIN' || room.actionState.type === 'CAPTAIN' || room.actionState.type === 'FOREIGN_AID') {
                clearCoupTimer(room);
                if (block) {
                    room.actionState.blockerId = socket.id;
                    room.actionState.blockRole = blockRole || (room.actionState.type === 'ASSASSIN' ? '귀부인' : (room.actionState.type === 'FOREIGN_AID' ? '공작' : '사령관'));
                    room.actionState.phase = 'WAIT_CHALLENGE';
                    emitCoupUpdate(roomCode, room);
                    startCoupTimer(room, roomCode, 30, () => {
                        const curRoom = coupRooms[roomCode];
                        if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'WAIT_CHALLENGE') return;
                        const actorP = curRoom.players.find(p => p.id === curRoom.actionState.actorId);
                        if (actorP) {
                            processChallengeResponse(curRoom, roomCode, actorP.id, false);
                        }
                    });
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

    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = coupRooms[roomCode];
            if (!room) return;
            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomCode);
            if (room.players.length === 0) {
                clearCoupTimer(room);
                delete coupRooms[roomCode];
            } else {
                emitCoupUpdate(roomCode, room);
            }
        } catch(e){}
    });

    // ⏱️ [버그 수정] 튕김/연결 끊김 발생 시 1분(60초) 동안 유예하며, 1분 내 미복구 시 방에서 퇴장 및 턴/흐름 막힘 방지 로직 보완
    socket.on('disconnect', () => {
        try {
            for (let roomCode in coupRooms) {
                const room = coupRooms[roomCode];
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.connected = false;
                    const disconnectKey = `${roomCode}_${player.userId}`;
                    
                    if (coupDisconnectTimers[disconnectKey]) clearTimeout(coupDisconnectTimers[disconnectKey]);
                    
                    // LOBBY 상태일 때는 즉시 제거, GAME 상태일 때는 1분 유예
                    if (room.phase === 'LOBBY') {
                        room.players = room.players.filter(p => p.id !== socket.id);
                        if (room.players.length === 0) {
                            clearCoupTimer(room);
                            delete coupRooms[roomCode];
                        } else {
                            emitCoupUpdate(roomCode, room);
                        }
                    } else {
                        coupDisconnectTimers[disconnectKey] = setTimeout(() => {
                            delete coupDisconnectTimers[disconnectKey];
                            const currentRoom = coupRooms[roomCode];
                            if (!currentRoom) return;
                            
                            currentRoom.players = currentRoom.players.filter(p => p.userId !== player.userId);
                            if (currentRoom.players.length === 0) {
                                clearCoupTimer(currentRoom);
                                delete coupRooms[roomCode];
                            } else {
                                // 만약 튕긴 유저가 현재 차례였거나 응답 대기 중이었다면 먹통 방지를 위해 다음 턴/다음 상태로 강제 진행
                                if (currentRoom.turnId === player.id) {
                                    nextTurnCoup(currentRoom, roomCode);
                                } else if (currentRoom.actionState && currentRoom.actionState.currentPromptId === player.id) {
                                    processBlockResponse(currentRoom, roomCode, player.id, false);
                                }
                                emitCoupUpdate(roomCode, currentRoom);
                            }
                        }, 60000); // 1분 (60초)
                    }
                }
            }
        } catch(e) {}
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { 
    console.log(`🚀 포커, 플립7 & COUP 서버 구동 완료. 포트 ${PORT}`); 
});
