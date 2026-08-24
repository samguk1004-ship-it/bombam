const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 방 정보를 관리하는 객체
const rooms = {};

// 동물 데이터 정의 (클라이언트와 동일)
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

io.on('connection', (socket) => {
    console.log(`사용자 접속: ${socket.id}`);

    // 1. 방 입장 (Join Room)
    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                roomCode,
                players: [],
                phase: 'LOBBY', // LOBBY, PLAYING, GAME_OVER
                turnId: null,
                activeOffer: null,
                loserId: null
            };
        }

        const room = rooms[roomCode];
        
        // 이미 방에 있는 유저인지 확인 후 추가 또는 갱신
        let player = room.players.find(p => p.id === socket.id);
        if (!player) {
            player = {
                id: socket.id,
                name: userName,
                ready: false, // 기본 준비 상태 false
                hand: [],
                handCount: 0,
                penalties: []
            };
            room.players.push(player);
        }

        // 방 전체에 변경된 상태 전송
        io.to(roomCode).emit('roomUpdate', room);
    });

    // 2. 플레이어 준비 상태 토글 (핵심 수정 부분)
    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = ready; // 준비 상태 변경 반영
            console.log(`플레이어 준비 상태 변경: ${player.name} -> ${ready ? '준비 완료' : '대기 중'}`);
        }

        // 방에 있는 모든 참가자에게 갱신된 방 정보를 즉시 브로드캐스트
        io.to(roomCode).emit('roomUpdate', room);
    });

    // 3. 게임 시작
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        room.phase = 'PLAYING';
        
        // 카드 덱 생성 및 분배 로직
        const animalList = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        let instCounter = 1;

        animalList.forEach(animal => {
            // 각 동물별 카드 장수 설정 (기본 8종 * 8장 = 64장 등)
            const count = room.players.length >= 7 ? 8 : 8; 
            for (let i = 0; i < count; i++) {
                deck.push({
                    inst: `card_${instCounter++}`,
                    id: animal.id,
                    name: animal.name,
                    color: animal.color
                });
            }
        });

        // 덱 섞기 (Shuffle)
        deck.sort(() => Math.random() - 0.5);

        // 플레이어들에게 카드 분배
        const cardsPerPlayer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            p.hand = deck.slice(idx * cardsPerPlayer, (idx + 1) * cardsPerPlayer);
            p.handCount = p.hand.length;
            p.penalties = [];
            p.ready = false;
        });

        // 첫 번째 플레이어 턴 설정
        room.turnId = room.players[0].id;
        room.activeOffer = null;

        io.to(roomCode).emit('gameStarted', room);
    });

    // 4. 공격 제안 제출 (카드 제시)
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const attacker = room.players.find(p => p.id === socket.id);
        if (!attacker) return;

        // 손패에서 카드 제거
        attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);
        attacker.handCount = attacker.hand.length;

        room.activeOffer = {
            attackerId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim,
            seenIds: [socket.id]
        };

        io.to(roomCode).emit('onOffer', room);
    });

    // 5. 응답 제출 (진실 또는 거짓 판단)
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const receiver = room.players.find(p => p.id === room.id === offer.receiverId);
        
        const isActualTruth = offer.card.name === offer.claim;
        const guessCorrect = (guessIsTrue === isActualTruth);

        // 벌칙을 받을 사람 결정
        let penaltyId = '';
        if (guessCorrect) {
            penaltyId = offer.attackerId; // 맞추면 공격자가 벌칙
        } else {
            penaltyId = offer.receiverId; // 틀리면 수비자가 벌칙
        }

        const penaltyTarget = room.players.find(p => p.id === penaltyId);
        if (penaltyTarget) {
            penaltyTarget.penalties.push(offer.card);
        }

        room.phase = 'REVEAL';
        room.revealData = {
            guessCorrect,
            actualCard: offer.card,
            penaltyId
        };

        io.to(roomCode).emit('revealStart', room);

        // 잠시 후 다음 라운드로 전환 및 패배 조건 체크
        setTimeout(() => {
            // 패배 조건 체크 (동일한 벌칙 카드 4장 또는 손패 0장)
            for (const p of room.players) {
                // 동물별 카드 개수 체크
                const counts = {};
                p.penalties.forEach(c => {
                    counts[c.id] = (counts[c.id] || 0) + 1;
                    if (counts[c.id] >= 4 || p.hand.length === 0) {
                        room.phase = 'GAME_OVER';
                        room.loserId = p.id;
                    }
                });
            }

            if (room.phase !== 'GAME_OVER') {
                room.phase = 'PLAYING';
                room.turnId = penaltyId; // 벌칙을 받은 사람이 다음 턴 시작
                room.activeOffer = null;
                room.revealData = null;
            }

            io.to(roomCode).emit('roundResolved', room);
        }, 4000);
    });

    // 6. 연결 해제 처리
    socket.on('disconnect', () => {
        console.log(`사용자 퇴장: ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('roomUpdate', room);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
