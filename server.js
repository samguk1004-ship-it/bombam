const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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
const disconnectTimeouts = {};

function sanitizeRoom(room) { return room; }

function resolveResponseLogic(room, roomCode, guessIsTrue) {
    if (!room || !room.activeOffer || room.phase !== 'RESPONSE') return;

    room.phase = 'REVEAL'; 

    const { card, claim, receiverId, seenIds } = room.activeOffer;
    const attackerId = seenIds[seenIds.length - 1]; 
    
    let isTruth = false;
    if (claim === '왕카드') isTruth = card.isKing;
    else isTruth = (card.animalName === claim);

    const guessCorrect = (guessIsTrue === isTruth);
    let winnerId = guessCorrect ? receiverId : attackerId;
    let penaltyId = guessCorrect ? attackerId : receiverId;

    const winner = room.players.find(p => p.id === winnerId);
    const loser = room.players.find(p => p.id === penaltyId);
    if(!loser) return;

    let extraCard = null;
    if (claim === '왕카드' && winner && winner.penalties.length > 0) {
        const rIdx = Math.floor(Math.random() * winner.penalties.length);
        extraCard = winner.penalties.splice(rIdx, 1)[0];
        loser.penalties.push(extraCard);
    }

    loser.penalties.push(card);
    
    room.revealData = { guessCorrect, actualCard: card, winnerId, penaltyId, extraCard, claim };
    io.to(roomCode).emit('revealStart', sanitizeRoom(room));

    setTimeout(() => {
        const r = rooms[roomCode];
        if(!r) return;
        
        r.activeOffer = null;
        r.revealData = null;
        r.turnId = penaltyId; 
        r.phase = 'GAME'; 

        const penaltyLimit = r.players.length >= 7 ? 3 : 4;
        let isGameOver = false;
        let overLoserId = null;

        r.players.forEach(p => {
            if (p.hand.length === 0 && r.turnId === p.id) {
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
            r.phase = 'GAME_OVER';
            r.loserId = overLoserId;
        }
        io.to(roomCode).emit('roundResolved', sanitizeRoom(r));
    }, 6000); 
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        if (!rooms[roomCode]) {
            rooms[roomCode] = { phase: 'LOBBY', players: [], spectators: [], turnId: null, activeOffer: null, revealData: null, lastDisconnectTime: null };
        }
        const room = rooms[roomCode];
        
        let playerByUserId = room.players.find(p => p.userId === userId);
        let playerByName = room.players.find(p => p.name === userName);

        if (!playerByUserId && playerByName) {
            socket.emit('joinError', '이미 사용중인 닉네임입니다. 다른 닉네임을 사용해주세요.');
            return;
        }

        if (playerByUserId) {
            const oldId = playerByUserId.id;
            const newId = socket.id;
            playerByUserId.id = newId;
            playerByUserId.isReconnecting = false;
            playerByUserId.disconnectTime = null;

            if (room.turnId === oldId) room.turnId = newId;
            if (room.activeOffer) {
                if (room.activeOffer.receiverId === oldId) room.activeOffer.receiverId = newId;
                if (room.activeOffer.attackerId === oldId) room.activeOffer.attackerId = newId;
                const seenIdx = room.activeOffer.seenIds.indexOf(oldId);
                if (seenIdx !== -1) room.activeOffer.seenIds[seenIdx] = newId;
            }
            if (room.revealData) {
                if (room.revealData.winnerId === oldId) room.revealData.winnerId = newId;
                if (room.revealData.penaltyId === oldId) room.revealData.penaltyId = newId;
            }

            if (disconnectTimeouts[userId]) {
                clearTimeout(disconnectTimeouts[userId]);
                delete disconnectTimeouts[userId];
            }
        } else {
            if (room.phase !== 'LOBBY') {
                if (!room.spectators) room.spectators = [];
                room.spectators.push({ id: socket.id, name: userName });
                socket.join(roomCode);
                socket.emit('roomUpdate', sanitizeRoom(room));
                return;
            }

            let player = { id: socket.id, userId, name: userName, isBot, ready: false, hand: [], penalties: [], lastClaim: '', isReconnecting: false };
            room.players.push(player);
        }
        
        socket.join(roomCode);
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
        if (room.spectators) room.spectators = room.spectators.filter(s => s.id !== socket.id);
        if(room.players.length === 0) delete rooms[roomCode];
        else io.to(roomCode).emit('roomUpdate', sanitizeRoom(room));
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (pIndex !== -1) {
                const p = room.players[pIndex];
                if (room.phase === 'LOBBY') {
                    room.players.splice(pIndex, 1);
                    if (room.players.length === 0) delete rooms[code];
                    else io.to(code).emit('roomUpdate', sanitizeRoom(room));
                } else {
                    p.isReconnecting = true;
                    p.disconnectTime = Date.now();
                    room.lastDisconnectTime = Date.now(); 

                    const allDisconnected = room.players.every(pl => pl.isReconnecting);
                    if (allDisconnected) {
                        room.players.forEach(pl => {
                            if (disconnectTimeouts[pl.userId]) {
                                clearTimeout(disconnectTimeouts[pl.userId]);
                                delete disconnectTimeouts[pl.userId];
                            }
                        });
                        delete rooms[code];
                        return;
                    }

                    io.to(code).emit('roomUpdate', sanitizeRoom(room));

                    disconnectTimeouts[p.userId] = setTimeout(() => {
                        const r = rooms[code];
                        if (!r) return;
                        const idx = r.players.findIndex(pl => pl.userId === p.userId);
                        if (idx !== -1) {
                            const kickedPlayer = r.players[idx];
                            r.players.splice(idx, 1);
                            
                            if (r.phase !== 'GAME_OVER') {
                                const isActive = r.turnId === kickedPlayer.id || (r.activeOffer && r.activeOffer.receiverId === kickedPlayer.id);
                                
                                if (r.activeOffer && r.activeOffer.seenIds) {
                                    r.activeOffer.seenIds = r.activeOffer.seenIds.filter(id => id !== kickedPlayer.id);
                                }

                                if (isActive) {
                                    r.activeOffer = null;
                                    r.revealData = null;
                                    r.phase = 'GAME'; 
                                    if (r.players.length > 0) {
                                        r.turnId = r.players[Math.floor(Math.random() * r.players.length)].id;
                                    }
                                }
                                
                                if (r.players.length <= 1) {
                                    r.phase = 'GAME_OVER';
                                    r.loserId = kickedPlayer.id; 
                                }
                            }
                            io.to(code).emit('roomUpdate', sanitizeRoom(r));
                        }
                        delete disconnectTimeouts[p.userId];
                    }, 60000); 
                }
            } else if (room.spectators) {
                room.spectators = room.spectators.filter(s => s.id !== socket.id);
            }
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const animals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        let cardInst = 0;
        
        animals.forEach(animal => {
            for(let i = 0; i < 8; i++) {
                const isKing = (i === 0);
                const cardNumStr = `${animal.prefix}${i}`; 
                
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

        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        room.players.forEach(p => { p.hand = []; p.penalties = []; p.lastClaim = ''; });
        let pIdx = 0;
        while (deck.length > 0) {
            room.players[pIdx].hand.push(deck.pop());
            pIdx = (pIdx + 1) % room.players.length;
        }
        
        room.players.forEach(p => { p.handCount = p.hand.length; });
        room.phase = 'GAME';

        // 💡 [핵심 수정] 턴 지정 로직 (봇게임 선공 / 멀티게임 랜덤)
        const humanPlayers = room.players.filter(p => !p.isBot);
        if (humanPlayers.length === 1 && room.players.some(p => p.isBot)) {
            // 혼자하기 모드: 방 안의 진짜 사람(1명)이 선공
            room.turnId = humanPlayers[0].id;
        } else {
            // 멀티플레이 모드: 모든 플레이어 중에서 랜덤 선공
            room.turnId = room.players[Math.floor(Math.random() * room.players.length)].id;
        }

        room.activeOffer = null;
        room.revealData = null;
        
        io.to(roomCode).emit('gameStarted', sanitizeRoom(room));
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'GAME' || room.activeOffer) return;
        
        const attacker = room.players.find(p => p.id === socket.id);
        if (!attacker) return;

        attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);
        attacker.handCount = attacker.hand.length;
        attacker.lastClaim = claim;

        room.activeOffer = { card, claim, receiverId: targetId, seenIds: [socket.id], attackerId: socket.id };
        room.phase = 'RESPONSE';
        
        io.to(roomCode).emit('onOffer', sanitizeRoom(room));
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || !room.activeOffer) return;
        
        const passer = room.players.find(p => p.id === socket.id);
        if (passer) passer.lastClaim = newClaim;

        room.activeOffer.seenIds.push(socket.id);
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        
        io.to(roomCode).emit('onOffer', sanitizeRoom(room));
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        resolveResponseLogic(room, roomCode, guessIsTrue);
    });

    socket.on('forceTurnSkip', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const actingPlayerId = room.activeOffer ? room.activeOffer.receiverId : room.turnId;
        if (actingPlayerId !== targetId) return; 

        const targetPlayer = room.players.find(p => p.id === targetId);
        if(!targetPlayer) return;

        if (room.phase === 'GAME' && room.turnId === targetId && !room.activeOffer) {
            if (targetPlayer.hand.length > 0) {
                const rCard = targetPlayer.hand[Math.floor(Math.random() * targetPlayer.hand.length)];
                const possibleTargets = room.players.filter(p => p.id !== targetId && !p.isReconnecting);
                if (possibleTargets.length > 0) {
                    const rTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)].id;
                    const animals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
                    const rClaim = animals[Math.floor(Math.random() * animals.length)].name;

                    targetPlayer.hand = targetPlayer.hand.filter(c => c.inst !== rCard.inst);
                    targetPlayer.handCount = targetPlayer.hand.length;
                    
                    room.activeOffer = { card: rCard, claim: rClaim, receiverId: rTarget, seenIds: [targetId], attackerId: targetId };
                    room.phase = 'RESPONSE';
                    io.to(roomCode).emit('onOffer', sanitizeRoom(room));
                }
            }
        } else if (room.phase === 'RESPONSE' && room.activeOffer && room.activeOffer.receiverId === targetId) {
            resolveResponseLogic(room, roomCode, Math.random() < 0.5);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Cockroach Poker Server running on port ${PORT}`);
});
