const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

const BASE_ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://masi4882.dothome.co.kr/30.jpg?v=2026' },
    { id: 'bat', name: '박쥐', color: '#334155', img: 'https://masi4882.dothome.co.kr/50.jpg?v=2026' },
    { id: 'fly', name: '파리', color: '#15803d', img: 'https://masi4882.dothome.co.kr/70.jpg?v=2026' },
    { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://masi4882.dothome.co.kr/20.jpg?v=2026' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://masi4882.dothome.co.kr/40.jpg?v=2026' },
    { id: 'rat', name: '쥐', color: '#57534e', img: 'https://masi4882.dothome.co.kr/60.jpg?v=2026' },
    { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://masi4882.dothome.co.kr/00.jpg?v=2026' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://masi4882.dothome.co.kr/10.jpg?v=2026' }
];

const EXTENDED_ANIMALS = [
    ...BASE_ANIMALS,
    { id: 'mosquito', name: '모기', color: '#dc2626', img: 'https://masi4882.dothome.co.kr/80.jpg?v=2026' },
    { id: 'snake', name: '뱀', color: '#16a34a', img: 'https://masi4882.dothome.co.kr/90.jpg?v=2026' }
];

function generateDeck(playerCount) {
    let deck = [];
    const animals = playerCount >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
    let instId = 0;
    for (const animal of animals) {
        for (let i = 0; i < 8; i++) {
            deck.push({ ...animal, inst: `${animal.id}_${instId++}` });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function checkGameOver(room) {
    const penaltyLimit = room.players.length >= 7 ? 3 : 4; 
    let loser = null;

    for (const p of room.players) {
        if (p.hand.length === 0 && room.turnId === p.id) { loser = p.id; break; }
        const counts = {};
        for (const pen of p.penalties) {
            counts[pen.id] = (counts[pen.id] || 0) + 1;
            if (counts[pen.id] >= penaltyLimit) { loser = p.id; break; }
        }
        if (loser) break;
    }

    if (loser) {
        room.phase = 'GAME_OVER';
        room.loserId = loser;
        return true;
    }
    return false;
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!rooms[roomCode]) {
            rooms[roomCode] = { phase: 'LOBBY', players: [], turnId: null, activeOffer: null, revealData: null };
        }
        const room = rooms[roomCode];
        
        if (room.phase !== 'LOBBY') return socket.emit('error', '게임이 이미 진행 중입니다.');
        if (room.players.length >= 8) return socket.emit('error', '방이 가득 찼습니다. (최대 8명)');
        if (room.players.find(p => p.name === userName)) return socket.emit('error', '이미 존재하는 닉네임입니다.');

        room.players.push({ id: socket.id, name: userName, ready: false, hand: [], penalties: [] });
        socket.join(roomCode);
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = ready;
            io.to(roomCode).emit('roomUpdate', room);
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.players[0].id !== socket.id) return; 
        
        const deck = generateDeck(room.players.length);
        room.players.forEach(p => p.hand = []);
        let dealIdx = 0;
        while (deck.length > 0) {
            room.players[dealIdx % room.players.length].hand.push(deck.pop());
            dealIdx++;
        }
        
        room.phase = 'IDLE';
        room.turnId = room.players[0].id;
        io.to(roomCode).emit('gameStarted', room);
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room || room.turnId !== socket.id || room.phase !== 'IDLE') return;

        const player = room.players.find(p => p.id === socket.id);
        player.hand = player.hand.filter(c => c.inst !== card.inst);
        
        room.activeOffer = { card, claim, receiverId: targetId, seenIds: [socket.id] };
        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || room.activeOffer.receiverId !== socket.id) return;
        
        room.activeOffer.seenIds.push(socket.id);
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || room.activeOffer.receiverId !== socket.id) return;

        const offer = room.activeOffer;
        const actualAnimal = offer.card.name;
        const isActuallyTrue = (actualAnimal === offer.claim);
        const guessCorrect = (guessIsTrue === isActuallyTrue);
        
        const senderId = offer.seenIds[offer.seenIds.length - 1];
        const penaltyId = guessCorrect ? senderId : socket.id;

        room.revealData = {
            guessCorrect,
            actualCard: offer.card,
            penaltyId: penaltyId
        };
        room.phase = 'REVEAL';
        io.to(roomCode).emit('revealStart', room);

        setTimeout(() => {
            if (rooms[roomCode]) {
                const r = rooms[roomCode];
                const penaltyPlayer = r.players.find(p => p.id === penaltyId);
                if (penaltyPlayer) penaltyPlayer.penalties.push(offer.card);
                
                r.activeOffer = null;
                r.revealData = null;
                r.turnId = penaltyId;
                r.phase = 'IDLE';
                
                if (!checkGameOver(r)) {
                    io.to(roomCode).emit('roundResolved', r);
                } else {
                    io.to(roomCode).emit('roomUpdate', r); 
                }
            }
        }, 4000); 
    });

    // 🌟 이탈자 강력 대처 로직 추가 🌟
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            
            if (pIdx !== -1) {
                // 1. 해당 플레이어 방에서 제거
                room.players.splice(pIdx, 1);
                
                // 2. 아무도 없으면 방 폭파
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                    continue;
                }
                
                // 3. 게임 중 이탈 발생 시 처리
                if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                    if (room.players.length < 2) {
                        // 1명 남으면 남은 사람 강제 승리 (게임 오버)
                        room.phase = 'GAME_OVER';
                        room.loserId = socket.id; // 나간 사람을 패배자로 간주
                    } else {
                        // 나간 사람이 현재 턴이었던 경우, 다음 사람으로 턴 넘기기
                        if (room.turnId === socket.id) {
                            room.turnId = room.players[pIdx % room.players.length].id;
                            room.phase = 'IDLE';
                            room.activeOffer = null;
                        } 
                        // 카드를 건네받고 있던 사람이 나간 경우, 공격자에게 다시 턴을 줌
                        else if (room.activeOffer && room.activeOffer.receiverId === socket.id) {
                            const senderId = room.activeOffer.seenIds[room.activeOffer.seenIds.length - 1];
                            room.turnId = senderId || room.players[0].id;
                            room.phase = 'IDLE';
                            room.activeOffer = null;
                        }
                        
                        // 인원수 감소에 따른 패배조건(룰) 실시간 재적용 및 체크
                        checkGameOver(room);
                    }
                }
                io.to(roomCode).emit('roomUpdate', room);
            }
        }
    });
});

server.listen(4000, () => console.log('Server running on port 4000'));
