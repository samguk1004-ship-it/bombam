const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    connectionStateRecovery: {} // 연결 복구 기능 추가
});

let rooms = {};

io.on('connection', (socket) => {
    console.log('접속됨:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        
        // 방이 없으면 생성
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                code: roomCode, 
                players: [], 
                gameState: 'LOBBY', 
                turnId: null, 
                activeOffer: null,
                phase: 'IDLE'
            };
        }

        // 중복 입장 방지 및 유저 추가
        const room = rooms[roomCode];
        if (room.players.length >= 8) return socket.emit('errorMsg', '방이 가득 찼습니다.');
        
        const newUser = {
            id: socket.id,
            name: userName || `유저_${socket.id.substring(0, 4)}`,
            penalties: [],
            handCount: 0 // 다른 사람에게는 장수만 보여줌
        };

        room.players.push(newUser);
        
        // [중요] 방에 있는 모든 사람에게 최신 플레이어 목록 전송
        io.to(roomCode).emit('roomUpdate', room);
        console.log(`${userName}님이 ${roomCode}방에 입장함`);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        // 100장 덱 생성 로직 (이전과 동일)
        const ANIMALS = ['stinkbug','cockroach','bat','fly','toad','rat','scorpion','spider','mosquito','snake'];
        let deck = [];
        ANIMALS.forEach(id => {
            for(let i=0; i<10; i++) deck.push({ id, name: getKrName(id), inst: Math.random() });
        });
        deck.sort(() => Math.random() - 0.5);

        const cardsPer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            const hand = deck.slice(idx * cardsPer, (idx + 1) * cardsPer);
            p.handCount = hand.length;
            io.to(p.id).emit('yourHand', hand); // 본인에게만 카드 정보 전송
        });

        room.gameState = 'GAME';
        room.turnId = room.players[0].id;
        io.to(roomCode).emit('gameStarted', room);
    });

    // 닉네임 한글 변환 헬퍼
    function getKrName(id) {
        const mapping = { stinkbug:'노린재', cockroach:'바퀴벌레', bat:'박쥐', fly:'파리', toad:'두꺼비', rat:'쥐', scorpion:'전갈', spider:'거미', mosquito:'모기', snake:'뱀' };
        return mapping[id];
    }

    socket.on('disconnect', () => {
        // 유저가 나갔을 때 처리 로직을 넣으면 좋으나 일단 유지
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
