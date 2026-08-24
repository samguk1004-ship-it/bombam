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

const IMAGE_POOLS = {
    spider: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/0${i}.jpg?v=2026`),
    stinkbug: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/1${i}.jpg?v=2026`),
    toad: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/2${i}.jpg?v=2026`),
    cockroach: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/3${i}.jpg?v=2026`),
    scorpion: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/4${i}.jpg?v=2026`),
    bat: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/5${i}.jpg?v=2026`),
    rat: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/6${i}.jpg?v=2026`),
    fly: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/7${i}.jpg?v=2026`),
    mosquito: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/8${i}.jpg?v=2026`),
    snake: Array.from({length: 10}, (_, i) => `https://masi4882.dothome.co.kr/9${i}.jpg?v=2026`)
};

const BASE_ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f' },
    { id: 'bat', name: '박쥐', color: '#334155' },
    { id: 'fly', name: '파리', color: '#15803d' },
    { id: 'toad', name: '두꺼비', color: '#065f46' },
    { id: 'scorpion', name: '전갈', color: '#991b1b' },
    { id: 'rat', name: '쥐', color: '#57534e' },
    { id: 'spider', name: '거미', color: '#1e1b4b' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e' }
];

const EXTENDED_ANIMALS = [
    ...BASE_ANIMALS,
    { id: 'mosquito', name: '모기', color: '#dc2626' },
    { id: 'snake', name: '뱀', color: '#16a34a' }
];

const ROYAL_IMG_INDEX = 0; 

function generateDeck(playerCount) {
    let deck = [];
    const animals = playerCount >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
    let instId = 0;
    
    for (const animal of animals) {
        const royalImg = IMAGE_POOLS[animal.id][ROYAL_IMG_INDEX];
        const normalImages = IMAGE_POOLS[animal.id].filter((_, idx) => idx !== ROYAL_IMG_INDEX);
        const shuffledNormal = normalImages.sort(() => Math.random() - 0.5).slice(0, 7);
        const selectedImages = [royalImg, ...shuffledNormal].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < 8; i++) {
            const currentImg = selectedImages[i];
            const isRoyal = (currentImg === royalImg);
            
            deck.push({ 
                ...animal, 
                baseName: animal.name,
                name: isRoyal ? `${animal.name} 👑` : animal.name,
                isRoyal: isRoyal,
                inst: `${animal.id}_${instId++}`,
                img: currentImg 
            });
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
        const randomIndex = Math.floor(Math.random() * room.players.length);
        room.turnId = room.players[randomIndex].id;
        
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
        
        let isActuallyTrue = false;
        if (offer.claim === '왕카드') {
            isActuallyTrue = offer.card.isRoyal;
        } else {
            isActuallyTrue = (offer.card.baseName === offer.claim); 
        }
        
        const guessCorrect = (guessIsTrue === isActuallyTrue);
        
        const senderId = offer.seenIds[offer.seenIds.length - 1];
        const receiverId = socket.id;
        
        const penaltyId = guessCorrect ? senderId : receiverId; 
        const winnerId = guessCorrect ? receiverId : senderId;  

        let extraCard = null;
        const penaltyPlayer = room.players.find(p => p.id === penaltyId);
        const winnerPlayer = room.players.find(p => p.id === winnerId);

        // 🌟 여기서 미리 승자의 덱에서 추가 벌칙 카드를 빼둡니다. (클라이언트 화면에서 승자의 벌칙 카드가 즉시 줄어드는 효과)
        if (penaltyPlayer) {
            if (offer.claim === '왕카드' && winnerPlayer && winnerPlayer.penalties.length > 0) {
                const randIdx = Math.floor(Math.random() * winnerPlayer.penalties.length);
                extraCard = winnerPlayer.penalties.splice(randIdx, 1)[0];
            }
        }

        room.revealData = {
            guessCorrect,
            actualCard: offer.card,
            penaltyId: penaltyId,
            winnerId: winnerId,
            extraCard: extraCard // 클라이언트에 추가 벌칙 카드 정보 전송
        };
        
        room.phase = 'REVEAL';
        io.to(roomCode).emit('revealStart', room);

        // 🌟 추가 벌칙이 있다면 애니메이션 재생을 위해 서버 턴 지연 시간을 7.5초로 늘립니다.
        const resolveDelay = extraCard ? 7500 : 4000;

        setTimeout(() => {
            if (rooms[roomCode]) {
                const r = rooms[roomCode];
                const pPlayer = r.players.find(p => p.id === penaltyId);
                
                if (pPlayer) {
                    pPlayer.penalties.push(offer.card);
                    if (extraCard) {
                        pPlayer.penalties.push(extraCard); // 패자에게 추가 카드 최종 적용
                    }
                }
                
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
        }, resolveDelay); 
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                    continue;
                }
                
                if (room.phase !== 'LOBBY' && room.phase !== 'GAME_OVER') {
                    if (room.players.length < 2) {
                        room.phase = 'GAME_OVER';
                        room.loserId = socket.id; 
                    } else {
                        if (room.turnId === socket.id) {
                            room.turnId = room.players[pIdx % room.players.length].id;
                            room.phase = 'IDLE';
                            room.activeOffer = null;
                        } else if (room.activeOffer && room.activeOffer.receiverId === socket.id) {
                            const senderId = room.activeOffer.seenIds[room.activeOffer.seenIds.length - 1];
                            room.turnId = senderId || room.players[0].id;
                            room.phase = 'IDLE';
                            room.activeOffer = null;
                        }
                        checkGameOver(room);
                    }
                }
                io.to(roomCode).emit('roomUpdate', room);
            }
        }
    });
});

server.listen(4000, () => console.log('Server running on port 4000'));
