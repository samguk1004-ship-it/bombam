const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let rooms = {};

// 10종 동물 데이터
const ANIMALS = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f' },
    { id: 'bat', name: '박쥐', color: '#334155' },
    { id: 'fly', name: '파리', color: '#15803d' },
    { id: 'toad', name: '두꺼비', color: '#065f46' },
    { id: 'scorpion', name: '전갈', color: '#991b1b' },
    { id: 'rat', name: '쥐', color: '#57534e' },
    { id: 'spider', name: '거미', color: '#1e1b4b' },
    { id: 'stinkbug', name: '노린재', color: '#854d0e' },
    { id: 'mosquito', name: '모기', color: '#4c0519' },
    { id: 'snake', name: '뱀', color: '#33691e' }
];

io.on('connection', (socket) => {
    // [1] 방 입장
    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                code: roomCode, players: [], gameState: 'LOBBY', turnId: null, activeOffer: null 
            };
        }
        const room = rooms[roomCode];
        if (room.players.length >= 8) return socket.emit('errorMsg', '방이 가득 찼습니다.');

        room.players.push({
            id: socket.id, name: userName, hand: [], penalties: [], seenIds: []
        });
        io.to(roomCode).emit('roomUpdate', room);
    });

    // [2] 게임 시작
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        // 100장 카드 생성 (10종 x 10장)
        let deck = [];
        ANIMALS.forEach(a => {
            for(let i=0; i<10; i++) deck.push({...a, inst: Math.random()});
        });
        deck.sort(() => Math.random() - 0.5);

        // 카드 분배
        const cardsPer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            p.hand = deck.slice(idx * cardsPer, (idx + 1) * cardsPer);
            io.to(p.id).emit('yourHand', p.hand);
        });

        room.gameState = 'GAME';
        room.turnId = room.players[0].id;
        room.phase = 'IDLE';
        io.to(roomCode).emit('gameStarted', room);
    });

    // [3] 공격 (Offer)
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        room.activeOffer = { card, claim, senderId: socket.id, receiverId: targetId, seenIds: [socket.id] };
        room.phase = 'RESPONSE';
        const sender = room.players.find(p => p.id === socket.id);
        sender.hand = sender.hand.filter(c => c.inst !== card.inst);
        io.to(roomCode).emit('onOffer', room);
    });

    // [4] 응답/판정 (Challenge)
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        const offer = room.activeOffer;
        const actualIsTrue = offer.card.name === offer.claim;
        const loserId = (guessIsTrue !== actualIsTrue) ? offer.receiverId : offer.senderId;

        room.phase = 'REVEAL';
        io.to(roomCode).emit('revealStart', { room, loserId, win: guessIsTrue === actualIsTrue });

        setTimeout(() => {
            if (!rooms[roomCode]) return;
            const loser = room.players.find(p => p.id === loserId);
            loser.penalties.push(offer.card);
            
            // 패배 조건 (7장)
            const counts = loser.penalties.reduce((acc, c) => { acc[c.id] = (acc[c.id] || 0) + 1; return acc; }, {});
            if (Object.values(counts).some(v => v >= 7) || loser.hand.length === 0) {
                io.to(roomCode).emit('gameOver', loser.name);
                delete rooms[roomCode];
            } else {
                room.turnId = loserId;
                room.activeOffer = null;
                room.phase = 'IDLE';
                io.to(roomCode).emit('roundResolved', room);
            }
        }, 3000);
    });

    // [5] 패스 (Pass)
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        room.activeOffer.senderId = socket.id;
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        room.activeOffer.seenIds.push(socket.id);
        room.phase = 'RESPONSE';
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('disconnect', () => {
        // 연결 끊김 처리 (생략 가능)
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
