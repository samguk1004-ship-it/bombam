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

// 게임 방 상태 저장소
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                roomCode,
                players: [],
                phase: 'IDLE',
                turnId: null,
                activeOffer: null,
                revealData: null
            };
        }
        
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id,
                name: userName,
                ready: false,
                hand: [],
                penalties: [],
                handCount: 0
            });
        }
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) player.ready = ready;
            io.to(roomCode).emit('roomUpdate', room);
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.phase = 'IDLE';
            room.turnId = room.players[0].id; // 방장이 선공
            
            // 데모용 카드 분배 로직 (실제 게임에 맞게 카드 배열을 생성하여 나눠주세요)
            const animals = ['cockroach', 'bat', 'fly', 'toad', 'scorpion', 'rat', 'spider', 'stinkbug'];
            room.players.forEach(p => {
                p.hand = Array(8).fill(null).map((_, i) => ({
                    id: animals[Math.floor(Math.random() * animals.length)],
                    name: "동물카드",
                    inst: `${p.id}_${i}_${Math.random()}` // 고유 ID 부여 필수
                }));
                p.handCount = p.hand.length;
                p.penalties = [];
            });
            
            io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if (room) {
            // 제출한 사람 손에서 카드 제거
            const attacker = room.players.find(p => p.id === socket.id);
            if(attacker) {
                attacker.hand = attacker.hand.filter(c => c.inst !== card.inst);
                attacker.handCount = attacker.hand.length;
            }

            room.activeOffer = {
                card: card,
                claim: claim,
                receiverId: targetId,
                seenIds: [socket.id]
            };
            room.phase = 'RESPONSE';
            io.to(roomCode).emit('onOffer', room);
        }
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if (room && room.activeOffer) {
            room.activeOffer.seenIds.push(socket.id);
            room.activeOffer.receiverId = nextTargetId;
            room.activeOffer.claim = newClaim;
            io.to(roomCode).emit('onOffer', room);
        }
    });

    // 🌟 [가장 핵심적인 서버 수정 부분] 진실/거짓 판정 시 데이터 파괴 방지 🌟
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if (!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const actualCard = offer.card;
        
        // 1. 진실/거짓 판정
        let isActuallyTrue = false;
        // (게임 로직에 따라 카드의 실제 동물 id와 claim(선언)을 비교)
        if (actualCard.id === offer.claim || actualCard.name === offer.claim) {
            isActuallyTrue = true;
        }
        
        const guessCorrect = (guessIsTrue === isActuallyTrue);

        // 2. 벌칙자 선정
        const attackerId = offer.seenIds[offer.seenIds.length - 1];
        const receiverId = offer.receiverId;
        const penaltyId = guessCorrect ? attackerId : receiverId;

        // 3. REVEAL 데이터 세팅 (이때 activeOffer를 지우지 않습니다!)
        room.phase = 'REVEAL';
        room.revealData = {
            actualCard: actualCard,
            guessCorrect: guessCorrect,
            penaltyId: penaltyId
        };

        // 4. 클라이언트에 결과 애니메이션 시작 신호 송신
        io.to(roomCode).emit('revealStart', room);

        // 🌟 5. [중요] 3.5초 대기 후 다음 라운드 진행 (이 대기 시간이 애니메이션을 살립니다)
        setTimeout(() => {
            const penalizedPlayer = room.players.find(p => p.id === penaltyId);
            if (penalizedPlayer) {
                penalizedPlayer.penalties.push(actualCard);
            }

            // 여기서 비로소 테이블 위의 카드를 청소합니다.
            room.activeOffer = null;
            room.revealData = null;
            room.turnId = penaltyId; // 진 사람이 다음 턴
            room.phase = 'IDLE';

            // 종료 조건 검사 (벌칙 4장 등) 로직이 있다면 여기에 추가
            io.to(roomCode).emit('roundResolved', room);
        }, 3500); 
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // 플레이어 퇴장 처리 로직 필요 시 구현
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
