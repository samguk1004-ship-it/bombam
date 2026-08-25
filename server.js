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
const disconnectTimeouts = {}; // 💡 60초 강제 퇴장 타이머 관리 객체

function sanitizeRoom(room) { return room; }

// 💡 판정 및 게임 오버 공통 로직 분리 (재사용성 향상)
function resolveResponseLogic(room, roomCode, guessIsTrue) {
    if (!room || !room.activeOffer) return;

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
    
    room.revealData = { guessCorrect, actualCard: card, winnerId, penaltyId, extraCard };
    room.phase = 'REVEAL';
    io.to(roomCode).emit('revealStart', sanitizeRoom(room));

    setTimeout(() => {
        const r = rooms[roomCode];
        if(!r) return;
        
        r.activeOffer = null;
        r.revealData = null;
        r.turnId = penaltyId; 
        r.phase = 'IDLE';

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
            rooms[roomCode] = { phase: 'LOBBY', players: [], spectators: [], turnId: null, activeOffer: null, revealData: null };
        }
        const room = rooms[roomCode];
        
        let playerByUserId = room.players.find(p => p.userId === userId);
        let playerByName = room.players.find(p => p.name === userName);

        // 💡 1. 닉네임 중복 방지 (본인의 재접속이 아닌데 같은 닉네임을 쓰는 경우)
        if (!playerByUserId && playerByName) {
            socket.emit('joinError', '이미 사용중인 닉네임입니다. 다른 닉네임을 사용해주세요.');
            return;
        }

        if (playerByUserId) {
            // 💡 2. 재접속 시 식별자(ID) 완벽 동기화 로직
            const oldId = playerByUserId.id;
            const newId = socket.id;
            playerByUserId.id = newId;
            playerByUserId.isReconnecting = false;
            playerByUserId.disconnectTime = null;

            // 게임 진행 중이던 상태값들 업데이트
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

            // 60초 강제 퇴장 타이머 정지
            if (disconnectTimeouts[userId]) {
                clearTimeout(disconnectTimeouts[userId]);
                delete disconnectTimeouts[userId];
            }
        } else {
            // 💡 3. 난입 시 관전 모드로 분기
            if (room.phase !== 'LOBBY') {
                if (!room.spectators) room.spectators = [];
                room.spectators.push({ id: socket.id, name: userName });
                socket.join(roomCode);
                socket.emit('roomUpdate', sanitizeRoom(room));
                return;
            }

            // 정상적인 로비 신규 접속
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
                    // 로비에서는 즉각 퇴장
                    room.players.splice(pIndex, 1);
                    if (room.players.length === 0) delete rooms[code];
                    else io.to(code).emit('roomUpdate', sanitizeRoom(room));
                } else {
                    // 게임 중에는 재접속 대기 모드 돌입
                    p.isReconnecting = true;
                    p.disconnectTime = Date.now();
                    io.to(code).emit('roomUpdate', sanitizeRoom(room));

                    // 💡 4. 1분(60초) 내 재접속 실패 시 강제 퇴장 및 랜덤 턴 배분
                    disconnectTimeouts[p.userId] = setTimeout(() => {
                        const r = rooms[code];
                        if (!r) return;
                        const idx = r.players.findIndex(pl => pl.userId === p.userId);
                        if (idx !== -1) {
                            const kickedPlayer = r.players[idx];
                            r.players.splice(idx, 1); // 배열에서 제거
                            
                            if (r.phase !== 'GAME_OVER') {
                                const isActive = r.turnId === kickedPlayer.id || (r.activeOffer && r.activeOffer.receiverId === kickedPlayer.id);
                                
                                // 기록에서 제외
                                if (r.activeOffer && r.activeOffer.seenIds) {
                                    r.activeOffer.seenIds = r.activeOffer.seenIds.filter(id => id !== kickedPlayer.id);
                                }

                                if (isActive) {
                                    r.activeOffer = null;
                                    r.revealData = null;
                                    r.phase = 'IDLE';
                                    if (r.players.length > 0) {
                                        // 💡 남은 인원 중 랜덤하게 턴 부여
                                        r.turnId = r.players[Math.floor(Math.random() * r.players.length)].id;
                                    }
                                }
                                
                                // 혼자 남았다면 게임 종료 처리
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
        resolveResponseLogic(room, roomCode, guessIsTrue);
    });

    // 💡 5. 클라이언트 0초 멈춤(프리징) 해결을 위한 강제 서버 스킵 로직
    socket.on('forceTurnSkip', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const actingPlayerId = room.activeOffer ? room.activeOffer.receiverId : room.turnId;
        if (actingPlayerId !== targetId) return; // 대상이 불일치하면 거부

        const targetPlayer = room.players.find(p => p.id === targetId);
        if(!targetPlayer) return;

        if (room.phase === 'GAME' || (room.phase === 'IDLE' && room.turnId === targetId)) {
            // 공격 차례일 때 시간 초과 -> 랜덤 타겟/선언으로 억지 진행
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
        } else if (room.phase === 'RESPONSE' && room.activeOffer.receiverId === targetId) {
            // 방어 차례일 때 시간 초과 -> 랜덤 판정(진실/거짓)
            resolveResponseLogic(room, roomCode, Math.random() < 0.5);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Cockroach Poker Server running on port ${PORT}`);
});
