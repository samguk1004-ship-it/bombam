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

// 방 상태를 클라이언트가 보기 좋게 가공하여 전송 (다른 사람의 패는 숨김)
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
                    // 본인 카드만 보이고, 다른 사람 카드는 개수(handCount)만 보임
                    hand: p.id === socket.id ? p.hand : [],
                    handCount: p.hand ? p.hand.length : 0,
                    penalties: p.penalties
                    // 💡 removeTimer 객체는 클라이언트로 보내면 에러가 나므로 맵핑 과정에서 자연스럽게 제외됨
                }))
            };
            socket.emit('roomUpdate', safeRoom);
        });
    });
};

io.on('connection', (socket) => {
    console.log(`[CONNECT] User connected: ${socket.id}`);

    // 1. 방 입장 (관전 모드 및 재접속 처리 포함)
    socket.on('joinRoom', ({ roomCode, userName, userId }) => {
        if (!roomCode || !userName) {
            return socket.emit('joinError', '방 코드와 닉네임을 확인해주세요.');
        }

        if (!rooms[roomCode]) {
            // 방이 없으면 새로 생성
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

        // 💡 재접속(Reconnect) 처리 로직
        const existingPlayerIndex = room.players.findIndex(p => p.userId === userId);
        
        if (existingPlayerIndex !== -1) {
            const player = room.players[existingPlayerIndex];
            
            // 💡 재접속 성공 시 방 퇴장(폭파) 타이머를 취소합니다.
            if (player.removeTimer) {
                clearTimeout(player.removeTimer);
                player.removeTimer = null;
            }

            console.log(`[RECONNECT] ${userName} reconnected to ${roomCode}`);
            player.id = socket.id; // 소켓 ID 업데이트
            socket.join(roomCode);
            broadcastRoom(roomCode);
            return;
        }

        // 💡 관전 모드 처리 로직
        if (room.phase !== 'LOBBY') {
            console.log(`[SPECTATOR] ${userName} joined ${roomCode} as spectator.`);
            socket.join(roomCode);
            
            const safeRoom = {
                ...room,
                players: room.players.map(p => ({ ...p, hand: [], handCount: p.hand ? p.hand.length : 0 }))
            };
            socket.emit('roomUpdate', safeRoom);
            return;
        }

        // 💡 정상적인 새 플레이어 입장
        if (room.players.length >= 8) {
            return socket.emit('joinError', '방의 최대 인원(8명)이 가득 찼습니다.');
        }

        const newPlayer = {
            id: socket.id,
            userId: userId, // 재접속 판별용 고유 ID
            name: userName,
            ready: false,
            hand: [],
            penalties: [],
            removeTimer: null // 삭제 타이머 객체 공간
        };

        room.players.push(newPlayer);
        socket.join(roomCode);
        console.log(`[JOIN] ${userName} joined ${roomCode}`);
        broadcastRoom(roomCode);
    });

    // 2. 준비 토글
    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'LOBBY') return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = ready;
            broadcastRoom(roomCode);
        }
    });

    // 3. 게임 시작
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'LOBBY') return;

        // 방장(첫 번째 플레이어)인지 확인
        if (room.players[0].id !== socket.id) return; 

        // 덱 생성 및 셔플
        const baseSet = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
        let deck = [];
        baseSet.forEach(animal => {
            for (let i = 0; i < 8; i++) {
                deck.push({ ...animal, inst: `${animal.id}_${i}`, img: animal.repImg });
            }
        });

        // Fisher-Yates 셔플
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // 카드 분배
        let pIndex = 0;
        while (deck.length > 0) {
            room.players[pIndex].hand.push(deck.pop());
            pIndex = (pIndex + 1) % room.players.length;
        }

        // 게임 상태 초기화
        room.phase = 'GAME';
        room.turnId = room.players[0].id; // 방장부터 시작
        room.players.forEach(p => p.penalties = []);

        io.in(roomCode).emit('gameStarted', { phase: 'GAME' });
        broadcastRoom(roomCode);
    });

    // 4. 카드 건네기 (공격)
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'GAME' || room.turnId !== socket.id) return;

        const attacker = room.players.find(p => p.id === socket.id);
        // 제출한 카드를 손패에서 제거
        attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);

        room.activeOffer = {
            card: card,
            claim: claim,
            receiverId: targetId,
            seenIds: [socket.id] // 카드를 확인한 사람 목록 (최초 공격자 포함)
        };
        room.phase = 'RESPONSE';

        io.in(roomCode).emit('onOffer', { phase: 'RESPONSE' });
        broadcastRoom(roomCode);
    });

    // 5. 카드 넘기기 (패스)
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || !room.activeOffer) return;
        if (room.activeOffer.receiverId !== socket.id) return; // 수비자가 아니면 차단

        room.activeOffer.seenIds.push(socket.id);
        room.activeOffer.claim = newClaim;
        room.activeOffer.receiverId = nextTargetId;

        io.in(roomCode).emit('onOffer', { phase: 'RESPONSE' });
        broadcastRoom(roomCode);
    });

    // 6. 진실/거짓 판정 로직
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'RESPONSE' || !room.activeOffer) return;
        if (room.activeOffer.receiverId !== socket.id) return;

        const actualCard = room.activeOffer.card;
        const claim = room.activeOffer.claim;
        const attackerId = room.activeOffer.seenIds[room.activeOffer.seenIds.length - 1];

        // 예측 결과 계산
        const isActuallyTrue = (actualCard.name === claim);
        const guessCorrect = (guessIsTrue === isActuallyTrue);

        let penaltyId, winnerId;
        if (guessCorrect) {
            penaltyId = attackerId; // 맞췄으므로 공격자가 먹음
            winnerId = socket.id;
        } else {
            penaltyId = socket.id; // 틀렸으므로 수비자가 먹음
            winnerId = attackerId;
        }

        const penaltyPlayer = room.players.find(p => p.id === penaltyId);
        const winningPlayer = room.players.find(p => p.id === winnerId);
        
        let extraCard = null;

        // 더블 페널티 룰렛 판정 로직 (왕카드 선언 시)
        if (claim === '왕카드' && winningPlayer.penalties.length > 0) {
            const randomIndex = Math.floor(Math.random() * winningPlayer.penalties.length);
            extraCard = winningPlayer.penalties[randomIndex];
            winningPlayer.penalties.splice(randomIndex, 1);
            penaltyPlayer.penalties.push(extraCard);
        }

        // 이번 턴의 벌칙 카드 부여
        penaltyPlayer.penalties.push(actualCard);

        room.revealData = {
            guessCorrect,
            actualCard,
            winnerId,
            penaltyId,
            extraCard
        };
        room.phase = 'REVEAL';

        io.in(roomCode).emit('revealStart', { phase: 'REVEAL' });
        broadcastRoom(roomCode);

        // 연출 대기 후 라운드 정리 및 게임 오버 판정
        setTimeout(() => {
            const penaltyLimit = room.players.length >= 7 ? 3 : 4;
            
            // 동일 벌칙 카드 한계 초과 여부 확인
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
                room.turnId = penaltyPlayer.id; // 벌칙을 먹은 사람이 다음 턴 선공
                room.activeOffer = null;
                room.revealData = null;
            }

            broadcastRoom(roomCode);
        }, extraCard ? 6500 : 4000); 
    });

    // 💡 7. 사용자 연결 종료 및 빈 방 폭파 로직
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
        
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const player = room.players.find(p => p.id === socket.id);
            
            if (player) {
                // 1분(60초) 내 재접속 기능을 위해 배열에서 당장 지우지 않고 대기 타이머 생성
                player.removeTimer = setTimeout(() => {
                    // 1분이 지나도 안 돌아오면 유저를 명단에서 완전히 삭제
                    room.players = room.players.filter(p => p.userId !== player.userId);
                    console.log(`[LEAVE] ${player.name} 님이 1분 미접속으로 방(${roomCode})에서 제거되었습니다.`);
                    
                    // 💡 유저를 제거한 후 남은 인원이 아무도 없다면 방을 폭파시킵니다.
                    if (room.players.length === 0) {
                        console.log(`[DESTROY] 방(${roomCode})에 남은 인원이 없어 완전히 폭파되었습니다 💥`);
                        delete rooms[roomCode];
                    } else {
                        // 남아있는 인원이 있다면 남은 사람들에게 인원 축소(퇴장) 내역 갱신
                        broadcastRoom(roomCode);
                    }
                }, 60000); // 60,000ms = 1분
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 서버가 정상적으로 실행되었습니다. 포트: ${PORT}`);
});
