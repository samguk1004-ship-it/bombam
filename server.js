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

// ==========================================
// 🃏 [1] 바퀴벌레 포커 전용 공간 (Namespace: /poker)
// ==========================================
const pokerIo = io.of('/poker');
const pokerRooms = {};

// 서버용 동물 데이터 (프론트엔드 이미지와 완벽 동기화)
const BASE_ANIMALS = [
    { id: 'spider', name: '거미', repImg: 'https://masi4882.dothome.co.kr/01.jpg?v=2026' },
    { id: 'stinkbug', name: '노린재', repImg: 'https://masi4882.dothome.co.kr/11.jpg?v=2026' },
    { id: 'toad', name: '두꺼비', repImg: 'https://masi4882.dothome.co.kr/21.jpg?v=2026' },
    { id: 'cockroach', name: '바퀴벌레', repImg: 'https://masi4882.dothome.co.kr/31.jpg?v=2026' },
    { id: 'scorpion', name: '전갈', repImg: 'https://masi4882.dothome.co.kr/41.jpg?v=2026' },
    { id: 'bat', name: '박쥐', repImg: 'https://masi4882.dothome.co.kr/51.jpg?v=2026' },
    { id: 'rat', name: '쥐', repImg: 'https://masi4882.dothome.co.kr/61.jpg?v=2026' },
    { id: 'fly', name: '파리', repImg: 'https://masi4882.dothome.co.kr/71.jpg?v=2026' }
];
const EXTENDED_ANIMALS = [ ...BASE_ANIMALS, 
    { id: 'mosquito', name: '모기', repImg: 'https://masi4882.dothome.co.kr/81.jpg?v=2026' }, 
    { id: 'snake', name: '뱀', repImg: 'https://masi4882.dothome.co.kr/91.jpg?v=2026' } 
];

pokerIo.on('connection', (socket) => {
    console.log('바퀴벌레 포커 접속:', socket.id);

    // 1. 방 입장
    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        socket.join(roomCode);
        if (!pokerRooms[roomCode]) pokerRooms[roomCode] = { roomCode, phase: 'LOBBY', players: [] };
        const room = pokerRooms[roomCode];
        
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id, userId, name: userName, isBot,
                ready: room.players.length === 0, 
                score: 0, hand: [], penalties: [], handCount: 0
            });
        }
        pokerIo.to(roomCode).emit('roomUpdate', room);
    });

    // 2. 레디 상태 변경
    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = pokerRooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.ready = ready;
                pokerIo.to(roomCode).emit('roomUpdate', room);
            }
        }
    });

    // 3. 게임 시작 및 카드 셔플 분배
    socket.on('startGame', (roomCode) => {
        const room = pokerRooms[roomCode];
        if (room && room.players[0].id === socket.id) {
            const useAnimals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
            let deck = [];

            // 8장씩 덱 생성 (첫 1장은 왕카드로 취급)
            useAnimals.forEach(animal => {
                for (let i = 0; i < 8; i++) {
                    deck.push({
                        id: i === 0 ? `${animal.id}_king` : `${animal.id}_${i}`,
                        animalId: animal.id,
                        animalName: animal.name,
                        name: animal.name,
                        isKing: i === 0,
                        img: animal.repImg,
                        repImg: animal.repImg
                    });
                }
            });

            // 피셔-예이츠 셔플 알고리즘
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            // 초기화 및 분배
            room.players.forEach(p => { p.hand = []; p.penalties = []; p.handCount = 0; });
            
            let dealIndex = 0;
            while (dealIndex < deck.length) {
                room.players.forEach(p => {
                    if (dealIndex < deck.length) {
                        p.hand.push(deck[dealIndex]);
                        p.handCount++;
                        dealIndex++;
                    }
                });
            }

            room.phase = 'GAME';
            room.turnId = room.players[0].id;
            room.activeOffer = null;
            pokerIo.to(roomCode).emit('gameStarted', room);
        }
    });

    // 4. 첫 공격 (카드 건네기)
    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = pokerRooms[roomCode];
        if (!room) return;

        const attacker = room.players.find(p => p.id === socket.id);
        if (!attacker) return;

        // 공격자 손에서 카드 제거
        attacker.hand = attacker.hand.filter(c => c.id !== card.id);
        attacker.handCount = attacker.hand.length;
        attacker.lastClaim = claim;

        room.phase = 'RESPONSE';
        room.activeOffer = {
            senderId: socket.id,
            attackerId: socket.id,
            receiverId: targetId,
            card: card,
            claim: claim,
            seenIds: [socket.id]
        };

        pokerIo.to(roomCode).emit('onOffer', room);
    });

    // 5. 카드 확인 후 남에게 넘기기
    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = pokerRooms[roomCode];
        if (!room || !room.activeOffer) return;

        const player = room.players.find(pl => pl.id === socket.id);
        if (player) player.lastClaim = newClaim;

        room.activeOffer.senderId = socket.id;
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        room.activeOffer.seenIds.push(socket.id);

        pokerIo.to(roomCode).emit('onOffer', room);
    });

    // 6. 진실/거짓 판정 및 룰렛 & 결과 처리
    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = pokerRooms[roomCode];
        if (!room || !room.activeOffer) return;

        const offer = room.activeOffer;
        const actualCard = offer.card;
        
        // 정답 판정
        let isTrue = false;
        if (offer.claim === '왕카드') {
            isTrue = (actualCard.isKing === true);
        } else {
            isTrue = (actualCard.animalName === offer.claim);
        }

        const guessCorrect = (isTrue === guessIsTrue);
        const loserId = guessCorrect ? offer.senderId : offer.receiverId;
        const winnerId = guessCorrect ? offer.receiverId : offer.senderId;

        // 왕카드 공방일 경우 더블 페널티(룰렛) 처리
        let extraCard = null;
        if (actualCard.isKing || offer.claim === '왕카드') {
            const winner = room.players.find(p => p.id === winnerId);
            if (winner && winner.penalties.length > 0) {
                const rIndex = Math.floor(Math.random() * winner.penalties.length);
                extraCard = winner.penalties.splice(rIndex, 1)[0];
            }
        }

        const loser = room.players.find(p => p.id === loserId);
        if (loser) {
            loser.penalties.push(actualCard);
            if (extraCard) loser.penalties.push(extraCard);
        }

        room.phase = 'REVEAL';
        room.revealData = { winnerId, penaltyId: loserId, guessCorrect, actualCard, claim: offer.claim, extraCard };
        pokerIo.to(roomCode).emit('revealStart', room);

        // 애니메이션 종료 후 상태 업데이트 (5.5초 대기)
        setTimeout(() => {
            if (!pokerRooms[roomCode]) return;
            const currentRoom = pokerRooms[roomCode];
            
            let isGameOver = false;
            let finalLoserId = null;
            const penaltyLimit = currentRoom.players.length >= 7 ? 3 : 4;

            currentRoom.players.forEach(p => {
                // 손패 고갈 체크
                if (p.hand.length === 0) { isGameOver = true; finalLoserId = p.id; }
                
                // 동일 벌칙 누적 체크
                const counts = {};
                p.penalties.forEach(c => {
                    const baseId = c.id.replace('_king', '').replace(/_\d+$/, '');
                    counts[baseId] = (counts[baseId] || 0) + 1;
                    if (counts[baseId] >= penaltyLimit) { isGameOver = true; finalLoserId = p.id; }
                });
            });

            if (isGameOver) {
                currentRoom.phase = 'GAME_OVER';
                currentRoom.loserId = finalLoserId;
                pokerIo.to(roomCode).emit('roomUpdate', currentRoom);
            } else {
                currentRoom.phase = 'GAME';
                currentRoom.turnId = loserId; // 패배자가 다음 턴 시작
                currentRoom.activeOffer = null;
                currentRoom.revealData = null;
                pokerIo.to(roomCode).emit('roundResolved', currentRoom);
            }
        }, 5500); 
    });

    // 7. 타임아웃 강제 스킵 방어 로직
    socket.on('forceTurnSkip', ({ roomCode }) => {
        // 프론트엔드 자체 타이머와 충돌 방지용 (의도적으로 비워둠)
    });

    // 8. 연결 해제 처리
    socket.on('leaveRoom', (roomCode) => leavePokerRoom(socket, roomCode));
    socket.on('disconnect', () => {
        for (const roomCode in pokerRooms) leavePokerRoom(socket, roomCode);
    });
});

function leavePokerRoom(socket, roomCode) {
    const room = pokerRooms[roomCode];
    if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        socket.leave(roomCode);
        if (room.players.length === 0) {
            delete pokerRooms[roomCode];
        } else {
            room.players[0].ready = true; 
            pokerIo.to(roomCode).emit('roomUpdate', room);
        }
    }
}


// ==========================================
// 🎯 [2] 플립 7 전용 공간 (Namespace: /flip7)
// ==========================================
const flip7Io = io.of('/flip7');
const flip7Rooms = {};

flip7Io.on('connection', (socket) => {
    console.log('플립 7 접속:', socket.id);

    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        socket.join(roomCode);
        if (!flip7Rooms[roomCode]) flip7Rooms[roomCode] = { roomCode, phase: 'LOBBY', players: [] };
        const room = flip7Rooms[roomCode];
        
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({
                id: socket.id, userId, name: userName, isBot,
                ready: room.players.length === 0, 
                score: 0
            });
        }
        flip7Io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = flip7Rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.ready = ready;
                flip7Io.to(roomCode).emit('roomUpdate', room);
            }
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = flip7Rooms[roomCode];
        if (room && room.players[0].id === socket.id) {
            room.phase = 'PLAYING';
            flip7Io.to(roomCode).emit('gameStarted', room);
        }
    });

    socket.on('leaveRoom', (roomCode) => leaveFlip7Room(socket, roomCode));
    socket.on('disconnect', () => {
        for (const roomCode in flip7Rooms) leaveFlip7Room(socket, roomCode);
    });
});

function leaveFlip7Room(socket, roomCode) {
    const room = flip7Rooms[roomCode];
    if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        socket.leave(roomCode);
        if (room.players.length === 0) {
            delete flip7Rooms[roomCode];
        } else {
            room.players[0].ready = true; 
            flip7Io.to(roomCode).emit('roomUpdate', room);
        }
    }
}

// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 봄밤놀이터 통합 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
