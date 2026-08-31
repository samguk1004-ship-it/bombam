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

// --- 유틸리티 함수 ---
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

function appendJosa(word, josa) {
    return word + getJosa(word, josa);
}

// 🚀 메모리 누수 방지용 중앙 타이머 관리자
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

// 🚀 공통 방 폭파(Destroy) 관리 함수
function destroyRoom(roomsObj, disconnectTimers, roomCode, ioNamespace, message) {
    const room = roomsObj[roomCode];
    if (!room) return;
    
    TimerHelper.clearAll(room); // 모든 비동기 타이머 해제

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
// 🃏 [1] 바퀴벌레 포커 전용 (Namespace: /poker)
// ==========================================
const pokerIo = io.of('/poker');
const pokerRooms = {};

const POKER_ANIMALS = [
    { id: 'spider', name: '거미', img: 'https://masi4882.dothome.co.kr/01.jpg?v=2026' },
    { id: 'stinkbug', name: '노린재', img: 'https://masi4882.dothome.co.kr/11.jpg?v=2026' },
    { id: 'toad', name: '두꺼비', img: 'https://masi4882.dothome.co.kr/21.jpg?v=2026' },
    { id: 'cockroach', name: '바퀴벌레', img: 'https://masi4882.dothome.co.kr/31.jpg?v=2026' },
    { id: 'scorpion', name: '전갈', img: 'https://masi4882.dothome.co.kr/41.jpg?v=2026' },
    { id: 'bat', name: '박쥐', img: 'https://masi4882.dothome.co.kr/51.jpg?v=2026' },
    { id: 'rat', name: '쥐', img: 'https://masi4882.dothome.co.kr/61.jpg?v=2026' },
    { id: 'fly', name: '파리', img: 'https://masi4882.dothome.co.kr/71.jpg?v=2026' }
];
const POKER_EXT_ANIMALS = [ ...POKER_ANIMALS,
    { id: 'mosquito', name: '모기', img: 'https://masi4882.dothome.co.kr/81.jpg?v=2026' },
    { id: 'snake', name: '뱀', img: 'https://masi4882.dothome.co.kr/91.jpg?v=2026' }
];

function createPokerDeck(playerCount) {
    const animals = playerCount >= 7 ? POKER_EXT_ANIMALS : POKER_ANIMALS;
    let deck = [];
    animals.forEach(a => {
        for (let i = 0; i < 7; i++) {
            deck.push({ id: `${a.id}_${i}`, animalId: a.id, animalName: a.name, name: a.name, img: a.img, isKing: false });
        }
        deck.push({ id: `${a.id}_king`, animalId: a.id, animalName: a.name, name: `왕 ${a.name}`, img: a.img, isKing: true });
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
                if (room.phase !== 'LOBBY') return;
                room.players.push({
                    id: socket.id, userId, name: userName, isBot,
                    ready: room.players.length === 0, score: 0, hand: [], penalties: [], handCount: 0, connected: true, isReconnecting: false
                });
            } else {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
                existingPlayer.isReconnecting = false;
                room.paused = room.players.some(p => !p.connected);
            }
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) { console.error('Poker joinRoom error:', e); }
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = pokerRooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.ready = ready;
                    pokerIo.to(roomCode).emit('roomUpdate', room);
                }
            }
        } catch(e) { console.error('Poker playerReady error:', e); }
    });

    socket.on('startGame', (roomCode) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || room.players.length < 1) return;

            room.phase = 'GAME';
            room.activeOffer = null;
            room.revealData = null;
            
            const deck = createPokerDeck(room.players.length);
            
            let pIdx = 0;
            while(deck.length > 0) {
                room.players[pIdx].hand.push(deck.pop());
                pIdx = (pIdx + 1) % room.players.length;
            }
            
            room.players.forEach(p => {
                p.handCount = p.hand.length;
                p.penalties = [];
                p.lastClaim = null;
            });

            room.turnId = room.players[Math.floor(Math.random() * room.players.length)].id;
            pokerIo.to(roomCode).emit('gameStarted', room);
        } catch (e) { console.error('Poker startGame error:', e); }
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room) return;
            
            const player = room.players.find(p => p.id === socket.id);
            if (!player || room.turnId !== socket.id) return;
            
            player.hand = player.hand.filter(c => c.id !== card.id);
            player.handCount = player.hand.length;
            player.lastClaim = claim;

            room.activeOffer = {
                attackerId: socket.id, senderId: socket.id, targetId: targetId, receiverId: targetId,
                card: card, claim: claim, seenIds: [socket.id]
            };
            room.phase = 'RESPONSE';
            pokerIo.to(roomCode).emit('onOffer', room);
        } catch (e) { console.error('Poker submitOffer error:', e); }
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || !room.activeOffer) return;
            
            const player = room.players.find(p => p.id === socket.id);
            if(player) player.lastClaim = newClaim;

            room.activeOffer.seenIds.push(socket.id);
            room.activeOffer.senderId = socket.id;
            room.activeOffer.targetId = nextTargetId;
            room.activeOffer.receiverId = nextTargetId;
            room.activeOffer.claim = newClaim;
            
            pokerIo.to(roomCode).emit('onOffer', room);
        } catch (e) { console.error('Poker submitPass error:', e); }
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || !room.activeOffer || room.activeOffer.receiverId !== socket.id) return;
            
            const offer = room.activeOffer;
            const card = offer.card;
            const claim = offer.claim;
            
            let actualClaimCorrect = false;
            if (claim === '왕카드') actualClaimCorrect = card.isKing;
            else actualClaimCorrect = (card.animalName === claim);
            
            const guessCorrect = (guessIsTrue === actualClaimCorrect);
            const lastSenderId = offer.seenIds[offer.seenIds.length - 1];
            
            const winnerId = guessCorrect ? socket.id : lastSenderId;
            const loserId = guessCorrect ? lastSenderId : socket.id;
            
            room.revealData = { winnerId, penaltyId: loserId, guessCorrect, actualCard: card, claim };

            const winner = room.players.find(p => p.id === winnerId);
            if (claim === '왕카드' && winner && winner.penalties && winner.penalties.length > 0) {
                const extraIdx = Math.floor(Math.random() * winner.penalties.length);
                const extraCard = winner.penalties.splice(extraIdx, 1)[0];
                room.revealData.extraCard = extraCard;
            }

            room.phase = 'REVEAL';
            pokerIo.to(roomCode).emit('revealStart', room);

            // 🚀 TimerHelper로 교체 (누수 방지)
            TimerHelper.add(room, () => {
                const curRoom = pokerRooms[roomCode];
                if (!curRoom || curRoom.phase !== 'REVEAL') return;
                
                const curLoser = curRoom.players.find(p => p.id === loserId);
                if (curLoser) {
                    curLoser.penalties.push(card);
                    if (curRoom.revealData.extraCard) {
                        curLoser.penalties.push(curRoom.revealData.extraCard);
                    }
                }

                const penaltyLimit = curRoom.players.length >= 7 ? 3 : 4;
                let isGameOver = false;
                
                if (curLoser) {
                    const counts = {};
                    curLoser.penalties.forEach(c => {
                        const aId = c.animalId || c.id.split('_')[0];
                        counts[aId] = (counts[aId] || 0) + 1;
                        if (counts[aId] >= penaltyLimit) isGameOver = true;
                    });
                    if (curLoser.handCount === 0) isGameOver = true;
                }

                if (isGameOver) {
                    curRoom.phase = 'GAME_OVER';
                    curRoom.loserId = loserId;
                    curRoom.activeOffer = null;
                    pokerIo.to(roomCode).emit('roomUpdate', curRoom);
                } else {
                    curRoom.phase = 'GAME';
                    curRoom.turnId = loserId; 
                    curRoom.activeOffer = null;
                    pokerIo.to(roomCode).emit('roundResolved', curRoom);
                }
            }, 5000);
        } catch (e) { console.error('Poker resolveResponse error:', e); }
    });

    socket.on('forceTurnSkip', ({ roomCode }) => {
        const room = pokerRooms[roomCode];
        if (room) pokerIo.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room) return;

            if (room.players.length > 0 && room.players[0].id === socket.id && room.players.some(p => p.isBot)) {
                destroyRoom(pokerRooms, null, roomCode, pokerIo, '방장이 퇴장하여 방이 폭파되었습니다.');
                return;
            }

            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomCode);
            
            if (room.players.length === 0) destroyRoom(pokerRooms, null, roomCode, pokerIo);
            else pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) { console.error('Poker leaveRoom error:', e); }
    });

    socket.on('disconnect', () => {
        try {
            for (let roomCode in pokerRooms) {
                const room = pokerRooms[roomCode];
                const playerIndex = room.players.findIndex(p => p.id === socket.id);
                
                if (playerIndex !== -1) {
                    if (playerIndex === 0 && room.players.some(p => p.isBot)) {
                        destroyRoom(pokerRooms, null, roomCode, pokerIo, '방장의 연결이 끊겨 방이 폭파되었습니다.');
                        continue;
                    }

                    if (room.phase === 'LOBBY') {
                        room.players.splice(playerIndex, 1);
                        if (room.players.length === 0) destroyRoom(pokerRooms, null, roomCode, pokerIo);
                        else pokerIo.to(roomCode).emit('roomUpdate', room);
                    } else {
                        room.players[playerIndex].connected = false;
                        room.players[playerIndex].isReconnecting = true;
                        room.paused = true; 
                        room.lastDisconnectTime = Date.now();
                        pokerIo.to(roomCode).emit('roomUpdate', room);
                    }
                }
            }
        } catch(e) { console.error('Poker disconnect error:', e); }
    });
});

// ==========================================
// 🎯 [2] 플립 7 전용 (Namespace: /flip7)
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
            if (flip7DisconnectTimers[disconnectKey]) {
                clearTimeout(flip7DisconnectTimers[disconnectKey]);
                delete flip7DisconnectTimers[disconnectKey];
            }
            
            let existingPlayer = room.players.find(p => (userId && p.userId === userId) || (userName && p.name === userName));
            if (!existingPlayer) {
                const isSpectator = room.phase !== 'LOBBY';
                room.players.push({ id: socket.id, userId, name: userName, isBot, ready: room.players.length === 0, score: 0, connected: true, isSpectator });
            } else {
                existingPlayer.id = socket.id; existingPlayer.connected = true;
                socket.to(roomCode).emit('playerReconnected', { id: socket.id });
            }
            flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) { console.error('Flip7 joinRoom error:', e); }
    });
    
    socket.on('playerReady', ({ roomCode, ready }) => {
        try {
            const room = flip7Rooms[roomCode];
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) { player.ready = ready; flip7Io.to(roomCode).emit('roomUpdate', room); }
            }
        } catch(e) { console.error('Flip7 playerReady error:', e); }
    });
    
    socket.on('startGame', (roomCode) => {
        try {
            const room = flip7Rooms[roomCode];
            if (room) { room.phase = 'GAME'; flip7Io.to(roomCode).emit('gameStarted', room); }
        } catch(e) { console.error('Flip7 startGame error:', e); }
    });
    
    socket.on('sendGameStateSync', ({ roomCode, gameState }) => {
        try { socket.to(roomCode).emit('updateGameStateSync', gameState); } catch(e) {}
    });
    
    socket.on('requestSyncFromOthers', (roomCode) => {
        try { socket.to(roomCode).emit('provideGameState'); } catch(e) {}
    });
    
    socket.on('leaveRoom', (roomCode) => {
        try {
            const room = flip7Rooms[roomCode];
            if (!room) return;

            if (room.players.length > 0 && room.players[0].id === socket.id && room.players.some(p => p.isBot)) {
                destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io, '방장이 퇴장하여 방이 폭파되었습니다.');
                return;
            }

            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomCode);
            if (room.players.length === 0) destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io);
            else flip7Io.to(roomCode).emit('roomUpdate', room);
        } catch(e) { console.error('Flip7 leaveRoom error:', e); }
    });
    
    socket.on('disconnect', () => {
        try {
            for (let roomCode in flip7Rooms) {
                const room = flip7Rooms[roomCode];
                const playerIndex = room.players.findIndex(p => p.id === socket.id);
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];

                    if (playerIndex === 0 && room.players.some(p => p.isBot)) {
                        destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io, '방장의 연결이 끊겨 방이 폭파되었습니다.');
                        continue;
                    }

                    player.connected = false;
                    const disconnectKey = `${roomCode}_${player.userId}`;
                    if (flip7DisconnectTimers[disconnectKey]) clearTimeout(flip7DisconnectTimers[disconnectKey]);
                    
                    if (room.phase === 'LOBBY') {
                        room.players.splice(playerIndex, 1);
                        if (room.players.length === 0) destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io);
                        else flip7Io.to(roomCode).emit('roomUpdate', room);
                    } else {
                        flip7Io.to(roomCode).emit('playerDisconnected', { id: player.id, name: player.name });
                        flip7DisconnectTimers[disconnectKey] = setTimeout(() => {
                            delete flip7DisconnectTimers[disconnectKey];
                            const currentRoom = flip7Rooms[roomCode];
                            if (!currentRoom) return;
                            currentRoom.players = currentRoom.players.filter(p => p.userId !== player.userId);
                            if (currentRoom.players.length === 0) {
                                destroyRoom(flip7Rooms, flip7DisconnectTimers, roomCode, flip7Io);
                            } else {
                                flip7Io.to(roomCode).emit('playerKicked', { userId: player.userId, name: player.name });
                                flip7Io.to(roomCode).emit('roomUpdate', currentRoom);
                            }
                        }, 60000);
                    }
                }
            }
        } catch(e) { console.error('Flip7 disconnect error:', e); }
    });
});

// ==========================================
// 🗡️ [3] 쿠 전용 (Namespace: /coup)
// ==========================================
const coupIo = io.of('/coup');
const coupRooms = {};
const coupDisconnectTimers = {}; 

function emitCoupUpdate(roomCode, room) {
    const safeRoom = {
        ...room,
        timer: room.timer ? { endTime: room.timer.endTime, duration: room.timer.duration } : null
    };
    coupIo.to(roomCode).emit('roomUpdate', safeRoom);
}

function clearCoupMainTimer(room) {
    if (room.timer && room.timer.timeoutId) {
        clearTimeout(room.timer.timeoutId);
        room.timer.timeoutId = null;
    }
    room.timer = null;
}

function startCoupTimer(room, roomCode, durationSec, callback) {
    clearCoupMainTimer(room);
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
    clearCoupMainTimer(room);
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
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '시간 초과로 소득(+1)을 획득했습니다.' });
        }

        const alive = currentRoom.players.filter(p => !p.isDead);
        if (alive.length <= 1) {
            currentRoom.phase = 'GAME_OVER';
            currentRoom.winner = alive[0]?.name || '생존자 없음';
            emitCoupUpdate(roomCode, currentRoom);
        } else {
            nextTurnCoup(currentRoom, roomCode);
            emitCoupUpdate(roomCode, currentRoom);
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
        clearCoupMainTimer(room);
        const actor = room.players.find(p => p.id === room.actionState.actorId);
        const target = room.players.find(p => p.id === room.actionState.targetId);
        if (actor) {
            if (room.actionState.type === 'FOREIGN_AID') {
                actor.coins += 2;
            } else if (room.actionState.type === 'DUKE') {
                actor.coins += 3;
            } else if (room.actionState.type === 'ASSASSIN') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: '처치에 성공했습니다.' });
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
    clearCoupMainTimer(room);
    const actor = room.players.find(p => p.id === room.actionState.actorId);

    if (block) { 
        room.actionState.blockerId = playerId;
        room.actionState.blockRole = blockRole || (room.actionState.type === 'ASSASSIN' ? '귀부인' : (room.actionState.type === 'FOREIGN_AID' || room.actionState.type === 'DUKE' ? '공작' : '사령관'));
        
        if (room.actionState.type === 'ASSASSIN') {
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.revealerId = playerId;
            room.actionState.type = 'ASSASSIN_BLOCK_CHALLENGE';
            emitCoupUpdate(roomCode, room);
            startCoupTimer(room, roomCode, 30, () => {
                const curRoom = coupRooms[roomCode];
                if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'REVEAL_CARD') return;
                const rev = curRoom.players.find(p => p.id === curRoom.actionState.revealerId);
                if (rev) {
                    const idx = rev.influence.findIndex(c => c.alive);
                    if (idx !== -1) processRevealCard(curRoom, roomCode, rev.id, idx);
                }
            });
            return;
        }

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
            clearCoupMainTimer(room);
            const target = room.players.find(p => p.id === room.actionState.targetId);
            if (room.actionState.type === 'ASSASSIN') {
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor ? actor.name : '', actionText: '처치에 성공했습니다.' });
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
    clearCoupMainTimer(room);
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    const actorName = actor ? actor.name : '';

    if (room.actionState.type === 'DUKE') {
        if (challenge) { 
            room.actionState.phase = 'REVEAL_CARD';
            room.actionState.revealerId = room.actionState.actorId; 
            room.actionState.type = 'DUKE_REVEAL';
            
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
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '징세를 포기하여 징세에 실패했습니다.' });
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
        } else if (room.actionState.type === 'CAPTAIN') {
            room.actionState.type = 'CAPTAIN_BLOCK_CHALLENGE';
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
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '공작의 방해로 해외 원조에 실패했습니다.' });
        } else if (room.actionState.type === 'CAPTAIN') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '강탈에 실패하였습니다.' });
        } else if (room.actionState.type === 'ASSASSIN') {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '상대의 귀부인 경호로 인해 암살에 실패했습니다.' });
        } else {
            coupIo.to(roomCode).emit('actionAnnounce', { actorName: actorName, actionText: '행동에 실패하였습니다.' });
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

    // 👇 REVEAL_ANIMATING 상태도 통과할 수 있도록 예외 추가!
    if (room.actionState && room.actionState.phase !== 'REVEAL_CARD' && room.actionState.phase !== 'REVEAL_ANIMATING') return;
    if (room.actionState) room.actionState.phase = 'REVEAL_ANIMATING';

    const actionType = room.actionState ? room.actionState.type : '';
    const actor = room.players.find(p => p.id === room.actionState.actorId);
    const actorName = actor ? actor.name : '';
    
    let isSuccess = false;
    let isFailPenaltyMatch = false;

    if (actionType === 'ASSASSIN_BLOCK_CHALLENGE') {
        isSuccess = (card.role === '귀부인');
    } else if (actionType === 'CAPTAIN_BLOCK_CHALLENGE' || actionType === 'CAPTAIN') {
        isSuccess = (card.role === '사령관' || card.role === '외교관');
    } else if (actionType === 'DUKE_REVEAL' || actionType === 'FOREIGN_AID' || actionType === 'FOREIGN_AID_BLOCK_CHALLENGE') {
        isSuccess = (card.role === '공작');
    } else if (actionType === 'ASSASSIN_FAIL_PENALTY') {
        isFailPenaltyMatch = (card.role === '자객');
    }

    if ((actionType === 'ASSASSIN_BLOCK_CHALLENGE' && !isSuccess) || (actionType === 'ASSASSIN_FAIL_PENALTY' && !isFailPenaltyMatch)) {
        card.alive = false;
        coupIo.to(roomCode).emit('blockRevealAnimation', {
            revealerId: revealer.id,
            cardIndex: cardIndex,
            revealedRole: card.role,
            isSuccess: false
        });

        coupIo.to(roomCode).emit('actionAnnounce', { actorName: revealer.name, actionText: '모두를 속였기에 모든패가 죽습니다.' });
        emitCoupUpdate(roomCode, room);

        // 🚀 TimerHelper로 누수 방지 처리
        TimerHelper.add(room, () => {
            const currentRoom = coupRooms[roomCode];
            if (!currentRoom) return;
            const currentRevealer = currentRoom.players.find(p => p.id === revealerId);
            if (!currentRevealer) return;

            const secondCardIdx = currentRevealer.influence.findIndex(c => c.alive);
            if (secondCardIdx !== -1) {
                const secondCard = currentRevealer.influence[secondCardIdx];
                secondCard.alive = false;
                currentRevealer.isDead = true;

                coupIo.to(roomCode).emit('blockRevealAnimation', {
                    revealerId: currentRevealer.id,
                    cardIndex: secondCardIdx,
                    revealedRole: secondCard.role,
                    isSuccess: false
                });

                coupIo.to(roomCode).emit('actionAnnounce', { actorName: currentRevealer.name, actionText: '모두를 속였기에 모든패가 죽습니다.' });
                emitCoupUpdate(roomCode, currentRoom);

                TimerHelper.add(currentRoom, () => {
                    const finalRoom = coupRooms[roomCode];
                    if (!finalRoom) return;
                    const alivePlayers = finalRoom.players.filter(p => !p.isDead);
                    if (alivePlayers.length <= 1) {
                        finalRoom.phase = 'GAME_OVER';
                        finalRoom.winner = alivePlayers[0]?.name || '생존자 없음';
                        finalRoom.actionState = null;
                        emitCoupUpdate(roomCode, finalRoom);
                    } else {
                        finalRoom.actionState = null;
                        nextTurnCoup(finalRoom, roomCode);
                        emitCoupUpdate(roomCode, finalRoom);
                    }
                }, 3000);
            } else {
                currentRevealer.isDead = true;
                TimerHelper.add(currentRoom, () => {
                    const finalRoom = coupRooms[roomCode];
                    if (!finalRoom) return;
                    const alivePlayers = finalRoom.players.filter(p => !p.isDead);
                    if (alivePlayers.length <= 1) {
                        finalRoom.phase = 'GAME_OVER';
                        finalRoom.winner = alivePlayers[0]?.name || '생존자 없음';
                        finalRoom.actionState = null;
                        emitCoupUpdate(roomCode, finalRoom);
                    } else {
                        finalRoom.actionState = null;
                        nextTurnCoup(finalRoom, roomCode);
                        emitCoupUpdate(roomCode, finalRoom);
                    }
                }, 1500);
            }
        }, 1500);
        return;
    }

    coupIo.to(roomCode).emit('blockRevealAnimation', {
        revealerId: revealer.id,
        cardIndex: cardIndex,
        revealedRole: card.role,
        isSuccess: actionType === 'ASSASSIN_FAIL_PENALTY' ? false : isSuccess 
    });

    // 🚀 TimerHelper로 교체
    TimerHelper.add(room, () => {
        const currentRoom = coupRooms[roomCode];
        if (!currentRoom) return;
        const currentRevealer = currentRoom.players.find(p => p.id === revealerId);
        if (!currentRevealer) return;
        
        const curRevealerName = currentRevealer ? currentRevealer.name : '';
        const currentCard = currentRevealer.influence[cardIndex];
        const curActionType = currentRoom.actionState ? currentRoom.actionState.type : '';
        const currentActor = currentRoom.players.find(p => p.id === currentRoom.actionState?.actorId);
        const curActorName = currentActor ? currentActor.name : '';

        if (curActionType === 'DUKE_REVEAL') {
            if (isSuccess) {
                const matchedRole = currentCard.role;
                currentRoom.deck.push(matchedRole);
                currentRoom.deck.sort(() => Math.random() - 0.5);
                currentCard.role = currentRoom.deck.pop();
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '공작을 증명하여 징세(+3코인)를 획득하고, 방해자는 패널티를 받습니다!' });
                
                if (currentActor && !currentActor.isDead) currentActor.coins += 3;
                
                currentRoom.actionState = {
                    ...currentRoom.actionState,
                    phase: 'REVEAL_CARD',
                    type: 'CHALLENGER_PENALTY',
                    revealerId: currentRoom.actionState.blockerId 
                };
                emitCoupUpdate(roomCode, currentRoom);
                
                startCoupTimer(currentRoom, roomCode, 30, () => {
                    const curR = coupRooms[roomCode];
                    if (!curR || !curR.actionState || curR.actionState.phase !== 'REVEAL_CARD') return;
                    
                    curR.actionState.phase = 'REVEAL_ANIMATING';
                    const rev = curR.players.find(p => p.id === curR.actionState.revealerId);
                    if (rev) {
                        const idx = rev.influence.findIndex(c => c.alive);
                        if (idx !== -1) processRevealCard(curR, roomCode, rev.id, idx);
                    }
                });
                return;

            } else {
                currentCard.alive = false;
                if (!currentRevealer.influence.some(c => c.alive)) currentRevealer.isDead = true;
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '공작이 아니므로 카드를 잃고 징세에 실패했습니다.' });
                
                const alivePlayers = currentRoom.players.filter(p => !p.isDead);
                if (alivePlayers.length <= 1) {
                    currentRoom.phase = 'GAME_OVER';
                    currentRoom.winner = alivePlayers[0]?.name || '생존자 없음';
                    emitCoupUpdate(roomCode, currentRoom);
                } else {
                    currentRoom.actionState = null;
                    nextTurnCoup(currentRoom, roomCode);
                    emitCoupUpdate(roomCode, currentRoom);
                }
                return;
            }
        }

        if (['COUP', 'ASSASSIN_DEATH', 'ASSASSIN_ATTACKER_DEATH', 'CHALLENGER_PENALTY', 'ASSASSIN_FAIL_PENALTY'].includes(curActionType)) {
            currentCard.alive = false;
            
            const hasAliveCards = currentRevealer.influence.some(c => c.alive);
            if (!hasAliveCards) currentRevealer.isDead = true;

            const alivePlayers = currentRoom.players.filter(p => !p.isDead);
            if (alivePlayers.length <= 1) {
                currentRoom.phase = 'GAME_OVER';
                currentRoom.winner = alivePlayers[0]?.name || '생존자 없음';
                currentRoom.actionState = null;
                emitCoupUpdate(roomCode, currentRoom);
                return;
            } else {
                if (curActionType === 'CHALLENGER_PENALTY') {
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전 실패로 카드를 잃었습니다.' });
                } else if (curActionType === 'ASSASSIN_ATTACKER_DEATH') {
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '암살 실패로 카드를 잃었습니다.' });
                } else if (curActionType === 'ASSASSIN_FAIL_PENALTY') {
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: curRevealerName, actionText: '자객이 있으니 자객 카드만 잃습니다.' });
                }
                
                currentRoom.actionState = null;
                nextTurnCoup(currentRoom, roomCode);
                emitCoupUpdate(roomCode, currentRoom);
                return;
            }
        } else if (curActionType === 'FOREIGN_AID_BLOCK_CHALLENGE') {
            if (isSuccess) {
                const matchedRole = currentCard.role;
                currentRoom.deck.push(matchedRole);
                currentRoom.deck.sort(() => Math.random() - 0.5);
                currentCard.role = currentRoom.deck.pop();
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전에 실패하여 원조를 받지 못하고 패널티를 받습니다.' });
                
                currentRoom.actionState = {
                    ...currentRoom.actionState,
                    phase: 'REVEAL_CARD',
                    type: 'CHALLENGER_PENALTY',
                    revealerId: currentRoom.actionState.actorId 
                };
                emitCoupUpdate(roomCode, currentRoom);
                
                startCoupTimer(currentRoom, roomCode, 30, () => {
                    const curR = coupRooms[roomCode];
                    if (!curR || !curR.actionState || curR.actionState.phase !== 'REVEAL_CARD') return;
                    
                    curR.actionState.phase = 'REVEAL_ANIMATING';
                    const rev = curR.players.find(p => p.id === curR.actionState.revealerId);
                    if (rev) {
                        const idx = rev.influence.findIndex(c => c.alive);
                        if (idx !== -1) processRevealCard(curR, roomCode, rev.id, idx);
                    }
                });
                return;

            } else {
                currentCard.alive = false;
                if (!currentRevealer.influence.some(c => c.alive)) currentRevealer.isDead = true;
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전에 성공하여 방해를 뚫고 해외 원조를 받습니다!' });
                if (currentActor && !currentActor.isDead) currentActor.coins += 2;
            }
        } else if (curActionType === 'ASSASSIN_BLOCK_CHALLENGE' || curActionType === 'CAPTAIN_BLOCK_CHALLENGE' || curActionType === 'CAPTAIN') {
            if (isSuccess) {
                const matchedRole = currentCard.role;
                currentRoom.deck.push(matchedRole);
                currentRoom.deck.sort(() => Math.random() - 0.5);
                currentCard.role = currentRoom.deck.pop();
                
                let text = '방어에 성공하여 도전자에게 패배 벌칙을 부여합니다.';
                let penaltyType = 'CHALLENGER_PENALTY';
                
                if (curActionType === 'ASSASSIN_BLOCK_CHALLENGE') {
                    text = '귀부인으로 암살 방어에 성공하여 도전자에게 자객 증명(반격)을 요구합니다.';
                    penaltyType = 'ASSASSIN_FAIL_PENALTY'; 
                }
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: currentRevealer.name, actionText: text });
                
                if (currentActor && !currentActor.isDead) {
                    currentRoom.actionState = {
                        ...currentRoom.actionState,
                        phase: 'REVEAL_CARD',
                        revealerId: currentActor.id,
                        type: penaltyType
                    };
                    emitCoupUpdate(roomCode, currentRoom);
                    startCoupTimer(currentRoom, roomCode, 30, () => {
                        const curR = coupRooms[roomCode];
                        if (!curR || !curR.actionState || curR.actionState.phase !== 'REVEAL_CARD') return;
                        
                        curR.actionState.phase = 'REVEAL_ANIMATING';
                        const rev = curR.players.find(p => p.id === curR.actionState.revealerId);
                        if (rev) {
                            const idx = rev.influence.findIndex(c => c.alive);
                            if (idx !== -1) processRevealCard(curR, roomCode, rev.id, idx);
                        }
                    });
                    return;
                } else {
                    currentRoom.actionState = null;
                    nextTurnCoup(currentRoom, roomCode);
                    emitCoupUpdate(roomCode, currentRoom);
                    return;
                }
            } else {
                currentCard.alive = false;
                if (!currentRevealer.influence.some(c => c.alive)) currentRevealer.isDead = true;
                
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: curActorName, actionText: '도전에 성공하여 강탈을 진행합니다.' });
                
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
            emitCoupUpdate(roomCode, currentRoom);
        }
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
                    coupIo.to(roomCode).emit('actionAnnounce', { actorName: '시스템', actionText: `${existingPlayer.name}님이 재접속했습니다.` });
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
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${appendJosa(target.name, '을/를')} 강탈합니다.` });
                setNextBlocker(room, roomCode);
                emitCoupUpdate(roomCode, room);
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
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${appendJosa(target.name, '을/를')} 암살 시도합니다.` });
                setNextBlocker(room, roomCode);
                return;
            } else if (action === 'COUP' && target) {
                actor.coins -= 7;
                room.actionState = { type: 'COUP', actorId: actor.id, revealerId: target.id, phase: 'REVEAL_CARD' };
                coupIo.to(roomCode).emit('actionAnnounce', { actorName: actor.name, actionText: `${target.name}에게 쿠를 사용했습니다.` });
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
                        nextTurnCoup(room, roomCode);
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

            coupIo.to(roomCode).emit('actionAnnounce', { actorName: player.name, actionText: '카드를 교환하였습니다.' });
            nextTurnCoup(room, roomCode);
            emitCoupUpdate(roomCode, room);
        } catch(e) { console.error('Coup ambassadorChosen error:', e); }
    });

    socket.on('blockResponse', ({ roomCode, block, blockRole }) => {
        try {
            const room = coupRooms[roomCode];
            if (!room || !room.actionState || room.actionState.phase !== 'WAIT_BLOCK' || room.actionState.currentPromptId !== socket.id) return;
            
            if (['ASSASSIN', 'CAPTAIN', 'FOREIGN_AID', 'DUKE'].includes(room.actionState.type)) {
                clearCoupMainTimer(room);
                if (block) {
                    room.actionState.blockerId = socket.id;
                    room.actionState.blockRole = blockRole || (room.actionState.type === 'ASSASSIN' ? '귀부인' : (room.actionState.type === 'FOREIGN_AID' || room.actionState.type === 'DUKE' ? '공작' : '사령관'));
                    
                    if (room.actionState.type === 'ASSASSIN') {
                        room.actionState.phase = 'REVEAL_CARD';
                        room.actionState.revealerId = socket.id;
                        room.actionState.type = 'ASSASSIN_BLOCK_CHALLENGE';
                        emitCoupUpdate(roomCode, room);
                        startCoupTimer(room, roomCode, 30, () => {
                            const curRoom = coupRooms[roomCode];
                            if (!curRoom || !curRoom.actionState || curRoom.actionState.phase !== 'REVEAL_CARD') return;
                            
                            curRoom.actionState.phase = 'REVEAL_ANIMATING';
                            const rev = curRoom.players.find(p => p.id === curRoom.actionState.revealerId);
                            if (rev) {
                                const idx = rev.influence.findIndex(c => c.alive);
                                if (idx !== -1) processRevealCard(curRoom, roomCode, rev.id, idx);
                            }
                        });
                        return;
                    }

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
                                    processBlockResponse(currentRoom, roomCode, player.id, false);
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { 
    console.log(`🚀 포커, 플립7 & COUP 서버 구동 완료. 포트 ${PORT}`); 
});
