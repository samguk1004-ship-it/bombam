const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// 동물 카드 기본 덱 세팅 (8종)
const BASE_ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', repImg: 'https://masi4882.dothome.co.kr/31.jpg?v=2026' },
    { id: 'bat', name: '박쥐', color: '#334155', repImg: 'https://masi4882.dothome.co.kr/51.jpg?v=2026' },
    { id: 'fly', name: '파리', color: '#15803d', repImg: 'https://masi4882.dothome.co.kr/71.jpg?v=2026' },
    { id: 'toad', name: '두꺼비', color: '#065f46', repImg: 'https://masi4882.dothome.co.kr/21.jpg?v=2026' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', repImg: 'https://masi4882.dothome.co.kr/41.jpg?v=2026' },
    { id: 'rat', name: '쥐', color: '#57534e', repImg: 'https://masi4882.dothome.co.kr/61.jpg?v=2026' },
    { id: 'spider', name: '거미', color: '#1e1b4b', repImg: 'https://masi4882.dothome.co.kr/01.jpg?v=2026' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e', repImg: 'https://masi4882.dothome.co.kr/11.jpg?v=2026' }
];

// 확장 덱 세팅 (7~8인용, 10종)
const EXTENDED_ANIMALS = [
    ...BASE_ANIMALS,
    { id: 'mosquito', name: '모기', color: '#dc2626', repImg: 'https://masi4882.dothome.co.kr/81.jpg?v=2026' },
    { id: 'snake', name: '뱀', color: '#16a34a', repImg: 'https://masi4882.dothome.co.kr/91.jpg?v=2026' }
];

// 메모리 상의 방 데이터 저장소
const rooms = {};

// 방 상태를 클라이언트가 보기 좋게 가공하여 전송
const broadcastRoom = (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    io.in(roomCode).fetchSockets().then(sockets => {
        sockets.forEach(socket => {
            const safeRoom = {
                ...room,
                players: room.players.map(p => ({
                    id: p.id,
                    userId: p.userId,
                    name: p.name,
                    ready: p.ready,
                    hand: p.id === socket.id ? p.hand : [],
                    handCount: p.hand ? p.hand.length : 0,
                    penalties: p.penalties,
                    isReconnecting: p.isReconnecting,
                    lastClaim: p.lastClaim // 💡 왕카드 연속 사용 체크용
                }))
            };
            socket.emit('roomUpdate', safeRoom);
        });
    });
};

io.on('connection', (socket) => {
    console.log(`[CONNECT] User connected: ${socket.id}`);

    // 1. 방 입장
    socket.on('joinRoom', ({ roomCode, userName, userId }) => {
        if (!roomCode || !userName) {
            return socket.emit('joinError', '방 코드와 닉네임을 확인해주세요.');
        }

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                phase: 'LOBBY',
                players: [],
                turnId: null,
                activeOffer: null,
                revealData: null,
                loserId: null
            };
        }

        const room = rooms[roomCode];

        const existingPlayerIndex = room.players.findIndex(p => p.userId === userId);
        if (existingPlayerIndex !== -1) {
            const player = room.players[existingPlayerIndex];
            if (player.removeTimer) {
                clearTimeout(player.removeTimer);
                player.removeTimer = null;
            }

            const oldId = player.id;
            player.id = socket.id; 
            player.isReconnecting = false; 

            if (room.turnId === oldId) room.turnId = socket.id;
            if (room.loserId === oldId) room.loserId = socket.id;
            if (room.activeOffer) {
                if (room.activeOffer.receiverId === oldId) room.activeOffer.receiverId = socket.id;
                if (room.activeOffer.seenIds) {
                    room.activeOffer.seenIds = room.activeOffer.seenIds.map(id => id === oldId ? socket.id : id);
                }
            }
            if (room.revealData) {
                if (room.revealData.winnerId === oldId) room.revealData.winnerId = socket.id;
                if (room.revealData.penaltyId === oldId) room.revealData.penaltyId = socket.id;
            }

            console.log(`[RECONNECT] ${player.name} reconnected to ${roomCode}`);
            socket.join(roomCode);
            broadcastRoom(roomCode);
            return;
        }

        const isNameTaken = room.players.some(p => p.name === userName);
        if (isNameTaken) {
            return socket.emit('joinError', '이미 방에서 사용 중인 닉네임입니다. 다른 닉네임으로 변경 후 접속해주세요.');
        }

        if (room.phase !== 'LOBBY') {
            socket.join(roomCode);
            const safeRoom = {
                ...room,
                players: room.players.map(p => ({ ...p, hand: [], handCount: p.hand ? p.hand.length : 0 }))
            };
            socket.emit('roomUpdate', safeRoom);
            return;
        }

        if (room.players.length >= 8) {
            return socket.emit('joinError', '방의 최대 인원(8명)이 가득 찼습니다.');
        }

        const newPlayer = {
            id: socket.id,
            userId: userId,
            name: userName,
            ready: false,
            hand: [],
            penalties: [],
            removeTimer: null,
            isReconnecting: false,
            lastClaim: null
        };

        room.players.push(newPlayer);
        socket.join(roomCode);
        broadcastRoom(roomCode);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'LOBBY') return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = ready;
            broadcastRoom(roomCode);
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'LOBBY') return;
        if (room.players[0].id !== socket.id) return; 

        const baseSet = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        baseSet.forEach(animal => {
            for (let i = 0; i < 8; i++) {
                deck.push({ ...animal, inst: `${animal.id}_${i}`, img: animal.repImg });
            }
        });

        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        let pIndex = 0;
        while (deck.length > 0) {
            room.players[pIndex].hand.push(deck.pop());
            pIndex = (pIndex + 1) % room.players.length;
        }

        room.phase = 'GAME';
        room.turnId = room.players[Math.floor(Math.random() * room.players.length)].id;
        
        room.players.forEach(p => { p.penalties = []; p.lastClaim = null; });

        io.in(roomCode).emit('gameStarted', { phase: 'GAME' });
        broadcastRoom(roomCode);
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'GAME' || room.turnId !== socket.id) return;

        const attacker = room.players.find(p => p.id === socket.id);
        
        // 💡 왕카드 연속 사용 금지 로직
        if (claim === '왕카드' && attacker.lastClaim === '왕카드') {
            return socket.emit('gameError', '왕은 연속으로 사용할수 없습니다.');
        }

        attacker.lastClaim = claim;
        attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);

        room.activeOffer = { card, claim, receiverId: targetId, seenIds: [socket.id] };
        room.phase = 'RESPONSE';

        io.in(roomCode).emit('onOffer', { phase: 'RESPONSE' });
        broadcastRoom(roomCode);
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || !room.activeOffer) return;
        if (room.activeOffer.receiverId !== socket.id) return;

        const attacker = room.players.find(p => p.id === socket.id);
        
        // 💡 넘길때도 왕카드 연속 사용 금지 검사
        if (newClaim === '왕카드' && attacker.lastClaim === '왕카드') {
            return socket.emit('gameError', '왕은 연속으로 사용할수 없습니다.');
        }

        attacker.lastClaim = newClaim;
        room.activeOffer.seenIds.push(socket.id);
        room.activeOffer.claim = newClaim;
        room.activeOffer.receiverId = nextTargetId;

        io.in(roomCode).emit('onOffer', { phase: 'RESPONSE' });
        broadcastRoom(roomCode);
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || !room.activeOffer) return;
        if (room.activeOffer.receiverId !== socket.id) return;

        const actualCard = room.activeOffer.card;
        const claim = room.activeOffer.claim;
        const attackerId = room.activeOffer.seenIds[room.activeOffer.seenIds.length - 1];

        const isActuallyTrue = (actualCard.name === claim);
        const guessCorrect = (guessIsTrue === isActuallyTrue);

        let penaltyId, winnerId;
        if (guessCorrect) {
            penaltyId = attackerId; winnerId = socket.id;
        } else {
            penaltyId = socket.id; winnerId = attackerId;
        }

        const penaltyPlayer = room.players.find(p => p.id === penaltyId);
        const winningPlayer = room.players.find(p => p.id === winnerId);
        
        let extraCard = null;

        if (claim === '왕카드' && winningPlayer.penalties.length > 0) {
            const randomIndex = Math.floor(Math.random() * winningPlayer.penalties.length);
            extraCard = winningPlayer.penalties[randomIndex];
            winningPlayer.penalties.splice(randomIndex, 1);
            penaltyPlayer.penalties.push(extraCard);
        }

        penaltyPlayer.penalties.push(actualCard);

        room.revealData = { guessCorrect, actualCard, winnerId, penaltyId, extraCard };
        room.phase = 'REVEAL';

        io.in(roomCode).emit('revealStart', { phase: 'REVEAL' });
        broadcastRoom(roomCode);

        setTimeout(() => {
            const penaltyLimit = room.players.length >= 7 ? 3 : 4;
            const isPenaltyOver = penaltyPlayer.penalties.reduce((acc, card) => {
                acc[card.id] = (acc[card.id] || 0) + 1;
                return acc;
            }, {});

            const hasLostByPenalty = Object.values(isPenaltyOver).some(count => count >= penaltyLimit);
            const hasLostByHand = penaltyPlayer.hand.length === 0;

            if (hasLostByPenalty || hasLostByHand) {
                room.phase = 'GAME_OVER';
                room.loserId = penaltyPlayer.id;
            } else {
                room.phase = 'GAME';
                room.turnId = penaltyPlayer.id;
                room.activeOffer = null;
                room.revealData = null;
            }

            broadcastRoom(roomCode);
        }, extraCard ? 6500 : 4000); 
    });

    socket.on('leaveRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        const pIndex = room.players.findIndex(p => p.id === socket.id);
        if (pIndex !== -1) {
            const player = room.players[pIndex];
            if (player.removeTimer) clearTimeout(player.removeTimer);

            room.players.splice(pIndex, 1);
            
            const isAllDisconnected = room.players.length === 0 || room.players.every(p => p.isReconnecting);
            if (isAllDisconnected) {
                room.players.forEach(p => { if (p.removeTimer) clearTimeout(p.removeTimer); });
                delete rooms[roomCode];
            } else {
                if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                    let turnFixed = false;
                    const getRandomPlayerId = () => room.players.length > 0 ? room.players[Math.floor(Math.random() * room.players.length)].id : null;

                    if (room.turnId === player.id) {
                        room.turnId = getRandomPlayerId();
                        turnFixed = true;
                    }
                    if (room.activeOffer && (room.activeOffer.receiverId === player.id || room.activeOffer.seenIds.includes(player.id))) {
                        room.activeOffer = null;
                        room.phase = 'GAME';
                        room.turnId = getRandomPlayerId();
                        turnFixed = true;
                    }
                    if (room.phase === 'REVEAL' && room.revealData && (room.revealData.penaltyId === player.id || room.revealData.winnerId === player.id)) {
                        room.revealData = null;
                        room.phase = 'GAME';
                        room.turnId = getRandomPlayerId();
                        turnFixed = true;
                    }

                    if (room.players.length <= 1) {
                        room.phase = 'LOBBY';
                        room.turnId = null;
                        room.activeOffer = null;
                        room.revealData = null;
                        room.players.forEach(p => { p.ready = false; p.hand = []; p.penalties = []; p.isReconnecting = false; p.lastClaim = null; });
                        io.in(roomCode).emit('gameError', `[알림] 진행 가능한 최소 인원(2명)이 부족하여 방이 로비로 리셋되었습니다.`);
                    } else {
                        const msg = turnFixed 
                            ? `[알림] 턴을 진행 중이던 ${player.name} 님이 퇴장하여, 진행 중이던 공방이 취소되고 무작위 플레이어에게 턴이 넘어갑니다.`
                            : `[알림] ${player.name} 님이 퇴장했습니다. 남은 인원만으로 계속 진행합니다!`;
                        io.in(roomCode).emit('gameError', msg);
                    }
                }
                broadcastRoom(roomCode);
            }
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const player = room.players.find(p => p.id === socket.id);
            
            if (player) {
                player.isReconnecting = true;
                const isAllDisconnected = room.players.every(p => p.isReconnecting);

                if (isAllDisconnected) {
                    room.players.forEach(p => { if (p.removeTimer) clearTimeout(p.removeTimer); });
                    delete rooms[roomCode];
                    continue; 
                }

                broadcastRoom(roomCode);
                const timeoutDuration = room.phase === 'LOBBY' ? 10000 : 60000;
                
                player.removeTimer = setTimeout(() => {
                    const pIndex = room.players.findIndex(p => p.userId === player.userId);
                    if (pIndex === -1) return;

                    room.players.splice(pIndex, 1);
                    const isAllDisconnectedNow = room.players.length === 0 || room.players.every(p => p.isReconnecting);
                    
                    if (isAllDisconnectedNow) {
                        room.players.forEach(p => { if (p.removeTimer) clearTimeout(p.removeTimer); });
                        delete rooms[roomCode];
                    } else {
                        if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                            let turnFixed = false;
                            const getRandomPlayerId = () => room.players.length > 0 ? room.players[Math.floor(Math.random() * room.players.length)].id : null;
                            
                            if (room.turnId === player.id) {
                                room.turnId = getRandomPlayerId();
                                turnFixed = true;
                            }
                            if (room.activeOffer && (room.activeOffer.receiverId === player.id || room.activeOffer.seenIds.includes(player.id))) {
                                room.activeOffer = null;
                                room.phase = 'GAME';
                                room.turnId = getRandomPlayerId();
                                turnFixed = true;
                            }
                            if (room.phase === 'REVEAL' && room.revealData && (room.revealData.penaltyId === player.id || room.revealData.winnerId === player.id)) {
                                room.revealData = null;
                                room.phase = 'GAME';
                                room.turnId = getRandomPlayerId();
                                turnFixed = true;
                            }

                            if (room.players.length <= 1) {
                                room.phase = 'LOBBY';
                                room.turnId = null;
                                room.activeOffer = null;
                                room.revealData = null;
                                room.players.forEach(p => { p.ready = false; p.hand = []; p.penalties = []; p.isReconnecting = false; p.lastClaim = null; });
                                io.in(roomCode).emit('gameError', `[알림] 진행 가능한 최소 인원(2명)이 부족하여 방이 로비로 리셋되었습니다.`);
                            } else {
                                const msg = turnFixed 
                                    ? `[알림] 턴을 진행 중이던 ${player.name} 님이 미접속으로 1분이 경과하여 퇴장되었습니다. 턴이 리셋됩니다.`
                                    : `[알림] ${player.name} 님이 미접속으로 퇴장했습니다. 남은 인원만으로 계속 진행합니다!`;
                                io.in(roomCode).emit('gameError', msg);
                            }
                        }
                        broadcastRoom(roomCode);
                    }
                }, timeoutDuration);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 서버가 정상적으로 실행되었습니다. 포트: ${PORT}`);
});
