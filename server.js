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

// 서버용 동물 데이터
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

    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        try {
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
        } catch(e) { console.error("joinRoom 에러:", e); }
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = pokerRooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) { player.ready = ready; pokerIo.to(roomCode).emit('roomUpdate', room); }
        }
    });

    socket.on('startGame', (roomCode) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || room.players.length === 0) return;
            if (room.players[0].id !== socket.id) return; // 방장만 시작 가능

            const useAnimals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
            let deck = [];

            // 카드 덱 생성
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

            // 셔플
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            // 분배
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

            room.phase = 'GAME'; // 상태 변경
            room.turnId = room.players[0].id;
            room.activeOffer = null;
            
            // 확실한 동기화를 위해 이벤트 2번 발송
            pokerIo.to(roomCode).emit('gameStarted', room);
            pokerIo.to(roomCode).emit('roomUpdate', room);
        } catch(e) { console.error("startGame 에러:", e); }
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room) return;
            const attacker = room.players.find(p => p.id === socket.id);
            if (!attacker) return;

            attacker.hand = attacker.hand.filter(c => c.id !== card.id);
            attacker.handCount = attacker.hand.length;
            attacker.lastClaim = claim;

            room.phase = 'RESPONSE';
            room.activeOffer = { senderId: socket.id, attackerId: socket.id, receiverId: targetId, card, claim, seenIds: [socket.id] };

            pokerIo.to(roomCode).emit('onOffer', room);
        } catch(e) { console.error("submitOffer 에러:", e); }
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || !room.activeOffer) return;
            const player = room.players.find(pl => pl.id === socket.id);
            if (player) player.lastClaim = newClaim;

            room.activeOffer.senderId = socket.id;
            room.activeOffer.receiverId = nextTargetId;
            room.activeOffer.claim = newClaim;
            room.activeOffer.seenIds.push(socket.id);

            pokerIo.to(roomCode).emit('onOffer', room);
        } catch(e) { console.error("submitPass 에러:", e); }
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        try {
            const room = pokerRooms[roomCode];
            if (!room || !room.activeOffer || !room.activeOffer.card) return;

            const offer = room.activeOffer;
            const actualCard = offer.card;
            
            let isTrue = false;
            if (offer.claim === '왕카드') isTrue = (actualCard.isKing === true);
            else isTrue = (actualCard.animalName === offer.claim);

            const guessCorrect = (isTrue === guessIsTrue);
            const loserId = guessCorrect ? offer.senderId : offer.receiverId;
            const winnerId = guessCorrect ? offer.receiverId : offer.senderId;

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

            setTimeout(() => {
                if (!pokerRooms[roomCode]) return;
                const currentRoom = pokerRooms[roomCode];
                let isGameOver = false;
                let finalLoserId = null;
                const penaltyLimit = currentRoom.players.length >= 7 ? 3 : 4;

                currentRoom.players.forEach(p => {
                    if (p.hand.length === 0) { isGameOver = true; finalLoserId = p.id; }
                    const counts = {};
                    p.penalties.forEach(c => {
                        const baseId = c.id.replace('_king', '').replace(/_\d+$/, '');
                        counts[baseId] = (counts[baseId] || 0) + 1;
                        if (counts[baseId] >= penaltyLimit) { isGameOver = true; finalLoserId = p.id; }
                    });
                });

                if (isGameOver) {
                    currentRoom.phase = 'GAME_OVER'; currentRoom.loserId = finalLoserId;
                    pokerIo.to(roomCode).emit('roomUpdate', currentRoom);
                } else {
                    currentRoom.phase = 'GAME'; currentRoom.turnId = loserId;
                    currentRoom.activeOffer = null; currentRoom.revealData = null;
                    pokerIo.to(roomCode).emit('roundResolved', currentRoom);
                }
            }, 5500); 
        } catch(e) { console.error("resolveResponse 에러:", e); }
    });

    socket.on('forceTurnSkip', ({ roomCode }) => {});

    socket.on('leaveRoom', (roomCode) => leavePokerRoom(socket, roomCode));
    socket.on('disconnect', () => { for (const roomCode in pokerRooms) leavePokerRoom(socket, roomCode); });
});

function leavePokerRoom(socket, roomCode) {
    const room = pokerRooms[roomCode];
    if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        socket.leave(roomCode);
        if (room.players.length === 0) delete pokerRooms[roomCode];
        else { room.players[0].ready = true; pokerIo.to(roomCode).emit('roomUpdate', room); }
    }
}


// ==========================================
// 🎯 [2] 플립 7 전용 공간 (Namespace: /flip7)
// ==========================================
const flip7Io = io.of('/flip7');
const flip7Rooms = {};

flip7Io.on('connection', (socket) => {

    socket.on('joinRoom', ({ roomCode, userName, userId, isBot }) => {
        socket.join(roomCode);
        if (!flip7Rooms[roomCode]) {
            // 타이머 관리를 위한 timers 객체 추가
            flip7Rooms[roomCode] = { roomCode, phase: 'LOBBY', players: [], timers: {} };
        }
        const room = flip7Rooms[roomCode];

        // 1. 중복 닉네임 방지 (재접속이 아닐 경우)
        const existingName = room.players.find(p => p.name === userName && p.userId !== userId);
        if (existingName) {
            socket.emit('joinError', '현재 대기방에 동일한 닉네임이 존재합니다. 다른 닉네임으로 접속해주세요.');
            return;
        }

        // 2. 재접속 로직 확인
        const existingPlayer = room.players.find(p => p.userId === userId);
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.connected = true;
            
            // 튕겨서 타이머가 돌고 있었다면 취소하고 재접속 알림
            if (room.timers && room.timers[userId]) {
                clearTimeout(room.timers[userId]);
                delete room.timers[userId];
                flip7Io.to(roomCode).emit('playerReconnected', { id: socket.id, userId, name: userName });
            }
        } else {
            // 신규 유저 등록
            room.players.push({ 
                id: socket.id, 
                userId, 
                name: userName, 
                isBot, 
                ready: room.players.length === 0, 
                score: 0,
                connected: true 
            });
        }
        flip7Io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = flip7Rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) { player.ready = ready; flip7Io.to(roomCode).emit('roomUpdate', room); }
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = flip7Rooms[roomCode];
        if (room && room.players.length > 0 && room.players[0].id === socket.id) {
            room.phase = 'PLAYING';
            flip7Io.to(roomCode).emit('gameStarted', room);
        }
    });

    // 방 스스로 나가기 (이 버튼을 누르면 타이머 없이 즉시 퇴장)
    socket.on('leaveRoom', (roomCode) => leaveFlip7Room(socket, roomCode));

    // 네트워크 끊김 처리 (비정상 종료 및 1분 타이머)
    socket.on('disconnect', () => {
        for (const roomCode in flip7Rooms) {
            const room = flip7Rooms[roomCode];
            const player = room.players.find(p => p.id === socket.id);
            
            if (player) {
                player.connected = false;
                
                // 게임 진행 중 튕겼을 때 -> 1분 타이머 작동
                if (room.phase === 'PLAYING' || room.phase === 'GAME') {
                    flip7Io.to(roomCode).emit('playerDisconnected', { id: player.id, userId: player.userId, name: player.name });
                    
                    if (!room.timers) room.timers = {};
                    room.timers[player.userId] = setTimeout(() => {
                        // 1분(60초) 경과 시 방에서 강제 제거
                        room.players = room.players.filter(p => p.userId !== player.userId);
                        
                        // 클라이언트에 킥 이벤트 발송 (남은 사람들이 턴을 넘기도록 프론트엔드에서 처리)
                        flip7Io.to(roomCode).emit('playerKicked', { userId: player.userId, name: player.name });
                        flip7Io.to(roomCode).emit('roomUpdate', room);
                        
                        delete room.timers[player.userId];
                        
                        // 인원이 다 나가서 없으면 방 폭파
                        if (room.players.length === 0) {
                            delete flip7Rooms[roomCode];
                        }
                    }, 60000); 
                } 
                // 대기방(로비)에서 튕겼을 때 -> 즉시 삭제
                else {
                    room.players = room.players.filter(p => p.id !== socket.id);
                    if (room.players.length === 0) {
                        delete flip7Rooms[roomCode];
                    } else {
                        // 방장이 튕긴 경우 다음 사람을 방장으로 만들어줌
                        room.players[0].ready = true;
                        flip7Io.to(roomCode).emit('roomUpdate', room);
                    }
                }
            }
        }
    });
});

function leaveFlip7Room(socket, roomCode) {
    const room = flip7Rooms[roomCode];
    if (room) {
        const player = room.players.find(p => p.id === socket.id);
        
        // 정상적으로 나가는 것이므로 타이머가 돌고 있다면 멈춤
        if (player && room.timers && room.timers[player.userId]) {
            clearTimeout(room.timers[player.userId]);
            delete room.timers[player.userId];
        }

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 서버 구동 완료: 포트 ${PORT}`); });
