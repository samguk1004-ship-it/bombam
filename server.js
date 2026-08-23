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

// 동물 종류별 기본 구성 (8종 기본 / 7인 이상 시 모기, 뱀 포함 10종)
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
    // 덱 섞기 (Fisher-Yates Shuffle)
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 5분(300,000ms) 동안 활동이 없는 유저 자동 강퇴 및 방 관리 루프
setInterval(() => {
    const now = Date.now();
    const TIMEOUT_LIMIT = 5 * 60 * 1000; // 5분

    for (let roomCode in rooms) {
        let room = rooms[roomCode];
        if (!room || !room.players) continue;

        let originalCount = room.players.length;
        
        room.players = room.players.filter(p => {
            if (p.lastActive && (now - p.lastActive > TIMEOUT_LIMIT)) {
                // 강퇴 이벤트 전송
                io.to(p.id).emit('kicked', '5분 동안 활동이 없어 방에서 추방되었습니다.');
                const targetSocket = io.sockets.sockets.get(p.id);
                if (targetSocket) {
                    targetSocket.leave(roomCode);
                }
                return false;
            }
            return true;
        });

        // 플레이어 인원이 변경되었을 때 처리
        if (room.players.length !== originalCount) {
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                // 게임 중이거나 로비일 때 상태 동기화
                if (room.phase === 'PLAYING') {
                    // 플레이어가 나갔을 때 턴이나 게임 오버 조건 체크 가능
                    const activePlayerExists = room.players.some(p => p.id === room.turnId);
                    if (!activePlayerExists && room.players.length > 0) {
                        room.turnId = room.players[0].id;
                    }
                }
                io.to(roomCode).emit('roomUpdate', getPublicRoomData(room));
            }
        }
    }
}, 10000); // 10초마다 체크

function getPublicRoomData(room) {
    return {
        ...room,
        players: room.players.map(p => ({
            ...p,
            handCount: p.hand.length,
            hand: undefined // 서버 보안을 위해 내 손패는 개별 관리 혹은 클라이언트 전송 시 제외 (아래 소켓 통신에서 처리)
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
                    hand: pl.id === p.id ? pl.hand : undefined // 본인 손패만 전달
                }))
            });
        }
    });
}

io.on('connection', (socket) => {
    // 유저 활동 감지 시 갱신
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

        // 카드 분배
        const cardsPerPlayer = Math.floor(deck.length / room.players.length);
        room.players.forEach((pl, idx) => {
            pl.hand = deck.slice(idx * cardsPerPlayer, (idx + 1) * cardsPerPlayer);
            pl.penalties = [];
        });

        room.phase = 'PLAYING';
        room.turnId = room.players[0].id;
        room.activeOffer = null;

        sendRoomState(roomCode);
        io.to(roomCode).emit('gameStarted', getPublicRoomData(room));
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        let room = rooms[roomCode];
        if (!room || room.turnId !== socket.id) return;

        let sender = room.players.find(p => p.id === socket.id);
        let receiver = room.players.find(p => p.id === targetId);
        if (!sender || !receiver) return;

        sender.lastActive = Date.now();

        // 덱에서 해당 카드 제거
        let cardIdx = sender.hand.findIndex(c => c.inst === card.inst);
        if (cardIdx === -1) return;
        sender.hand.splice(cardIdx, 1);

        room.activeOffer = {
            senderId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim,
            seenIds: [socket.id]
        };

        sendRoomState(roomCode);
        io.to(roomCode).emit('onOffer', getPublicRoomData(room));
    });

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

        io.to(roomCode).emit('revealStart', {
            ...getPublicRoomData(room),
            revealData: room.revealData
        });

        setTimeout(() => {
            // 게임오버 조건 체크 (동일한 벌칙 카드 4장 또는 손패 0장)
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
                room.turnId = penaltyId; // 벌칙을 받은 사람이 다음 턴 시작
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
