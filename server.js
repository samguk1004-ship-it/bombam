const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
app.use(cors());

const io = new Server(server, { 
    cors: { origin: "*" },
    transports: ['polling', 'websocket']
});

app.get('/', (req, res) => { res.send('Cockroach Server Stable'); });

let rooms = {};
const ANIMAL_TYPES = [
    { id: 'cockroach', name: '바퀴벌레', color: '#78350f' }, { id: 'bat', name: '박쥐', color: '#334155' },
    { id: 'fly', name: '파리', color: '#15803d' }, { id: 'toad', name: '두꺼비', color: '#065f46' },
    { id: 'scorpion', name: '전갈', color: '#991b1b' }, { id: 'rat', name: '쥐', color: '#57534e' },
    { id: 'spider', name: '거미', color: '#1e1b4b' }, { id: 'stinkbug', name: '노린재', color: '#854d0e' },
    { id: 'mosquito', name: '모기', color: '#4c0519' }, { id: 'snake', name: '뱀', color: '#33691e' }
];

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY', turnId: null, activeOffer: null };
        }
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], handCount: 0 });
        }
        io.to(roomCode).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        let deck = [];
        ANIMAL_TYPES.forEach(a => {
            for(let i=0; i<10; i++) deck.push({...a, inst: Math.random(), img: `https://cdn-icons-png.flaticon.com/512/1041/1041${getIconId(a.id)}.png`});
        });
        deck.sort(() => Math.random() - 0.5);
        const cardsPer = Math.floor(deck.length / room.players.length);
        room.players.forEach((p, idx) => {
            const hand = deck.slice(idx * cardsPer, (idx + 1) * cardsPer);
            p.handCount = hand.length;
            io.to(p.id).emit('yourHand', hand);
        });
        room.gameState = 'GAME';
        room.turnId = room.players[0].id;
        io.to(roomCode).emit('gameStarted', room);
    });

    socket.on('submitOffer', ({ roomCode, targetId, card, claim }) => {
        const room = rooms[roomCode];
        if(!room) return;
        room.activeOffer = { card, claim, senderId: socket.id, receiverId: targetId, seenIds: [socket.id] };
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('submitPass', ({ roomCode, nextTargetId, newClaim }) => {
        const room = rooms[roomCode];
        if(!room) return;
        room.activeOffer.senderId = socket.id;
        room.activeOffer.receiverId = nextTargetId;
        room.activeOffer.claim = newClaim;
        room.activeOffer.seenIds.push(socket.id);
        io.to(roomCode).emit('onOffer', room);
    });

    socket.on('resolveResponse', ({ roomCode, guessIsTrue }) => {
        const room = rooms[roomCode];
        if(!room) return;
        const offer = room.activeOffer;
        const actualIsTrue = offer.card.name === offer.claim;
        const attackWin = (guessIsTrue !== actualIsTrue);
        const loserId = attackWin ? offer.receiverId : offer.senderId;
        io.to(roomCode).emit('revealStart', { room, loserId, attackWin });
        setTimeout(() => {
            if (!rooms[roomCode]) return;
            const loserP = rooms[roomCode].players.find(p => p.id === loserId);
            loserP.penalties.push(offer.card);
            const counts = loserP.penalties.reduce((acc, c) => ({...acc, [c.id]: (acc[c.id] || 0) + 1}), {});
            if (Object.values(counts).some(v => v >= 7) || loserP.handCount === 0) {
                io.to(roomCode).emit('gameOver', loserP.name);
                delete rooms[roomCode];
            } else {
                rooms[roomCode].turnId = loserId;
                rooms[roomCode].activeOffer = null;
                io.to(roomCode).emit('roundResolved', rooms[roomCode]);
            }
        }, 4000);
    });

    socket.on('leaveRoom', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
            if (rooms[roomCode].players.length === 0) delete rooms[roomCode];
            else io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
        }
    });

    socket.on('disconnect', () => { /* 자동 퇴장 로직 생략(간소화) */ });
});

function getIconId(id) {
    const map = {cockroach:'042', bat:'046', fly:'045', toad:'051', scorpion:'049', rat:'044', spider:'335', stinkbug:'047', mosquito:'413', snake:'048'};
    return map[id] || '042';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
