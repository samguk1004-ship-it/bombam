const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ['polling', 'websocket']
});

app.get('/', (req, res) => { res.send('Cockroach Poker Server is Live'); });

// 게임에 사용될 동물 리스트 (8종류 x 8장 = 총 64장)
const ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041042.png' },
    { id: 'bat', name: '박쥐', color: '#334155', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041046.png' },
    { id: 'fly', name: '파리', color: '#15803d', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041045.png' },
    { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041051.png' },
    { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041049.png' },
    { id: 'rat', name: '쥐', color: '#57534e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041044.png' },
    { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://cdn-icons-png.flaticon.com/512/3026/3026335.png' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://cdn-icons-png.flaticon.com/512/1041/1041047.png' }
];

let rooms = {};

io.on('connection', (socket) => {
    console.log('🟢 유저 접속:', socket.id);

    // 1. 방 입장
    socket.on('joinRoom', ({ roomCode, userName }) => {
        if (!roomCode || !userName) return;
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], phase: 'LOBBY' };
        }
        const room = rooms[roomCode];
        
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], handCount: 0, hand: [] });
        }
        
        io.to(roomCode).emit('roomUpdate', room);
    });

    // 2. 게임 시작 및 카드 분배
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.phase = 'GAME';

        // 카드 덱 생성 (8종류 * 8장 = 64장)
        let deck = [];
        let instId = 0;
        ANIMALS.forEach(animal => {
            for(let i = 0; i < 8; i++) deck.push({ ...animal, inst: instId++ });
        });

        // 카드 섞기 (피셔-예이츠 셔플)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // 플레이어들에게 분배
        room.players.forEach(p => p.hand = []); // 손패 초기화
        let pIdx = 0;
        while(deck.length > 0) {
            room.players[pIdx % room.players.length].hand.push(deck.pop());
            pIdx++;
        }

        // 첫 번째 턴 지정 (방장)
        room.turnId = room.players[0].id;

        // 클라이언트에게 전송
        room.players.forEach(p => {
            p.handCount = p.hand.length;
            // 🚨 중요: 각자 자신의 손패만 따로 받습니다!
            io.to(p.id).emit('yourHand', p.hand); 
        });

        console.log(`[방 ${roomCode}] 게임 시작! 카드 분배 완료.`);
        io.to(roomCode).emit('gameStarted', room);
    });

    // 3. 카드 타겟에게 제출 (첫 공격)
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if(!room) return;

        // 보낸 사람의 손패에서 해당 카드 제거
        const sender = room.players.find(p => p.id === socket.id);
        sender.hand = sender.hand.filter(c => c.inst !== card.inst);
        sender.handCount = sender.hand.length;
        io.to(sender.id).emit('yourHand', sender.hand); // 보낸 사람의 화면 손패 업데이트

        // 진행중인 공격 정보 생성
        room.activeOffer = {
            originId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim,
            seenIds: [socket.id] // 이 카드를 확인한 사람 목록 (나중에 넘기기 기능에 사용)
        };
        
        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    // 4. 카드 다른 사람에게 넘기기 (확인 후 패스)
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if(!room || !room.activeOffer) return;

        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        room.activeOffer.seenIds.push(socket.id); // 확인한 사람 추가

        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    // 5. 진실/거짓 판독 및 페널티 부여
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if(!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const actualAnimal = offer.card.name; // 실제 동물 이름
        const claimedAnimal = offer.claim;    // 주장한 동물 이름

        const isTruth = (actualAnimal === claimedAnimal);
        const guessCorrect = (guessIsTrue === isTruth); // 맞췄는지 여부

        let penaltyReceiverId;
        
        if (guessCorrect) {
            // 맞췄다면, 마지막으로 카드를 넘긴 사람이 페널티를 받음
            penaltyReceiverId = offer.seenIds[offer.seenIds.length - 1];
        } else {
            // 틀렸다면, 판독을 시도한 사람(현재 수신자)이 페널티를 받음
            penaltyReceiverId = socket.id; 
        }

        // 벌점 카드장에 카드 등록
        const penalizedPlayer = room.players.find(p => p.id === penaltyReceiverId);
        penalizedPlayer.penalties.push(offer.card);

        // 다음 턴은 벌점을 받은 사람부터 시작
        room.turnId = penaltyReceiverId;
        room.activeOffer = null;
        room.phase = 'IDLE';

        io.to(roomCode).emit('roundResolved', room);
    });

    socket.on('disconnect', () => { 
        console.log('🔴 유저 접속 종료:', socket.id); 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
