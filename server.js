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

const rooms = {};

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

function createDeck(animalList) {
    let deck = [];
    let instId = 1;
    animalList.forEach(animal => {
        for (let i = 0; i < 6; i++) {
            deck.push({
                ...animal,
                inst: `card_${instId++}`
            });
        }
    });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 5분 미활동 유저 자동 강퇴 루프
setInterval(() => {
    const now = Date.now();
    const TIMEOUT_LIMIT = 5 * 60 * 1000;

    for (let roomCode in rooms) {
        let room = rooms[roomCode];
        if (!room || !room.players) continue;

        let originalCount = room.players.length;
        room.players = room.players.filter(p => {
            if (p.lastActive && (now - p.lastActive > TIMEOUT_LIMIT)) {
                io.to(p.id).emit('kicked', '5분 동안 활동이 없어 방에서 추방되었습니다.');
                const targetSocket = io.sockets.sockets.get(p.id);
                if (targetSocket) targetSocket.leave(roomCode);
                return false;
            }
            return true;
        });

        if (room.players.length !== originalCount) {
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('roomUpdate', getPublicRoomData(room));
            }
        }
    }
}, 10000);

function getPublicRoomData(room) {
    return {
        ...room,
        players: room.players.map(p => ({
            ...p,
            handCount: p.hand.length,
            hand: undefined
        }))
    };
}

function sendRoomState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.players.forEach(p => {
        const socketInstance = io.sockets.sockets.get(p.id);
        if (socketInstance) {
            socketInstance.emit('roomUpdate', {
                ...getPublicRoomData(room),
                players: room.players.map(pl => ({
                    ...pl,
                    handCount: pl.hand.length,
                    hand: pl.id === p.id ? pl.hand : undefined
                }))
            });
        }
    });
}

io.on('connection', (socket) => {
    socket.on('userActivity', () => {
        for (let code in rooms) {
            let p = rooms[code].players.find(x => x.id === socket.id);
            if (p) {
                p.lastActive = Date.now();
                break;
            }
        }
    });

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                roomCode,
                players: [],
                phase: 'LOBBY',
                turnId: null,
                activeOffer: null,
                loserId: null
            };
        }

        let room = rooms[roomCode];
        let existingPlayer = room.players.find(p => p.id === socket.id);

        if (!existingPlayer) {
            room.players.push({
                id: socket.id,
                name: userName || '참가자',
                hand: [],
                penalties: [],
                lastActive: Date.now()
            });
        } else {
            existingPlayer.lastActive = Date.now();
        }

        sendRoomState(roomCode);
    });

    socket.on('startGame', (roomCode) => {
        let room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        let p = room.players.find(x => x.id === socket.id);
        if (p) p.lastActive = Date.now();

        const animalList = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        const deck = createDeck(animalList);

        const cardsPerPlayer = Math.floor(deck.length / room.players.length);
        room.players.forEach((pl, idx) => {
            pl.hand = deck.slice(idx * cardsPerPlayer, (idx + 1) * cardsPerPlayer);
            pl.penalties = [];
        });

        room.phase = 'PLAYING';
        room.turnId = room.players[0].id;
        room.activeOffer = null;
        room.loserId = null;

        sendRoomState(roomCode);
        io.to(roomCode).emit('gameStarted', getPublicRoomData(room));
    });

    // 공격 카드 제출 및 블러핑 선언 처리
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        let room = rooms[roomCode];
        if (!room || room.turnId !== socket.id) return;

        let sender = room.players.find(p => p.id === socket.id);
        let receiver = room.players.find(p => p.id === targetId);
        if (!sender || !receiver) return;

        sender.lastActive = Date.now();

        let cardIdx = sender.hand.findIndex(c => c.inst === card.inst);
        if (cardIdx === -1) return;
        
        // 손패에서 카드 제거
        sender.hand.splice(cardIdx, 1);

        room.activeOffer = {
            senderId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim,
            seenIds: [socket.id]
        };
        room.phase = 'RESPONSE'; // 상태를 응답 대기 단계로 확실히 전환

        sendRoomState(roomCode);
        io.to(roomCode).emit('onOffer', getPublicRoomData(room));
    });

    // 카드 넘기기 처리
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        let room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        let currentReceiver = room.players.find(p => p.id === room.activeOffer.receiverId);
        if (currentReceiver) currentReceiver.lastActive = Date.now();

        room.activeOffer.seenIds.push(room.activeOffer.receiverId);
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;

        sendRoomState(roomCode);
        io.to(roomCode).emit('onOffer', getPublicRoomData(room));
    });

    // 진실/거짓 판독 처리
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        let room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        let receiver = room.players.find(p => p.id === room.activeOffer.receiverId);
        if (receiver) receiver.lastActive = Date.now();

        let actualCard = room.activeOffer.card;
        let claimedAnimal = room.activeOffer.claim;
        let isActuallyTheAnimal = (actualCard.name === claimedAnimal);

        let guessCorrect = (guessIsTrue === isActuallyTheAnimal);
        let penaltyId = guessCorrect ? room.activeOffer.receiverId : room.activeOffer.senderId;

        let penaltyPlayer = room.players.find(p => p.id === penaltyId);
        penaltyPlayer.penalties.push(actualCard);

        room.revealData = {
            guessCorrect,
            actualCard,
            penaltyId
        };
        room.phase = 'REVEAL';

        io.to(roomCode).emit('revealStart', {
            ...getPublicRoomData(room),
            revealData: room.revealData
        });

        setTimeout(() => {
            let loser = room.players.find(p => {
                if (p.hand.length === 0) return true;
                const counts = {};
                for (let c of p.penalties) {
                    counts[c.id] = (counts[c.id] || 0) + 1;
                    if (counts[c.id] >= 4) return true;
                }
                return false;
            });

            if (loser) {
                room.phase = 'GAME_OVER';
                room.loserId = loser.id;
                io.to(roomCode).emit('roomUpdate', getPublicRoomData(room));
            } else {
                room.turnId = penaltyId; 
                room.activeOffer = null;
                room.revealData = null;
                room.phase = 'PLAYING';
                sendRoomState(roomCode);
                io.to(roomCode).emit('roundResolved', getPublicRoomData(room));
            }
        }, 3500);
    });

    socket.on('disconnect', () => {
        for (let code in rooms) {
            let room = rooms[code];
            let idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                room.players.splice(idx, 1);
                if (room.players.length === 0) {
                    delete rooms[code];
                } else {
                    io.to(code).emit('roomUpdate', getPublicRoomData(room));
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
