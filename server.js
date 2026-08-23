// ... (상단 ANIMALS 등 기존 코드 동일)

io.on('connection', (socket) => {
    // 방 입장
    socket.on('joinRoom', ({ roomCode, userName }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { code: roomCode, players: [], gameState: 'LOBBY', turnId: null, activeOffer: null, phase: 'IDLE' };
        }
        const room = rooms[roomCode];
        if (!room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: userName, penalties: [], hand: [] });
        }
        io.to(roomCode).emit('roomUpdate', room);
    });

    // [추가] 방 나가기 로직
    const handleLeave = (socketId) => {
        for (const code in rooms) {
            const room = rooms[code];
            const playerIdx = room.players.findIndex(p => p.id === socketId);
            if (playerIdx !== -1) {
                const playerName = room.players[playerIdx].name;
                room.players.splice(playerIdx, 1);
                if (room.players.length === 0) {
                    delete rooms[code];
                } else {
                    // 방장이 나갔을 경우 방장 위임
                    if (room.turnId === socketId) room.turnId = room.players[0].id;
                    io.to(code).emit('roomUpdate', room);
                    io.to(code).emit('systemMsg', `${playerName}님이 방을 나갔습니다.`);
                }
            }
        }
    };

    socket.on('leaveRoom', () => {
        handleLeave(socket.id);
    });

    socket.on('disconnect', () => {
        handleLeave(socket.id);
    });

    // ... (startGame, submitOffer, resolveResponse 등 기존 로직 동일)
});
