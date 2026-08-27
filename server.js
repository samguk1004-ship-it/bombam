socket.on('startGame', (roomCode) => {
        const room = pokerRooms[roomCode];
        if (room && room.players[0].id === socket.id) {
            
            // 1. 플레이어 인원에 따른 덱(동물 종류) 구성
            const BASE_ANIMALS = [
                { id: 'spider', name: '거미' }, { id: 'stinkbug', name: '노린재' },
                { id: 'toad', name: '두꺼비' }, { id: 'cockroach', name: '바퀴벌레' },
                { id: 'scorpion', name: '전갈' }, { id: 'bat', name: '박쥐' },
                { id: 'rat', name: '쥐' }, { id: 'fly', name: '파리' }
            ];
            const EXTENDED_ANIMALS = [ ...BASE_ANIMALS, 
                { id: 'mosquito', name: '모기' }, { id: 'snake', name: '뱀' }
            ];
            
            const useAnimals = room.players.length >= 7 ? EXTENDED_ANIMALS : BASE_ANIMALS;
            let deck = [];

            // 2. 각 동물당 8장씩 카드 생성 (1장은 왕카드로 지정)
            useAnimals.forEach(animal => {
                for (let i = 0; i < 8; i++) {
                    deck.push({
                        id: `${animal.id}_${i}`,
                        animalName: animal.name,
                        isKing: i === 0, // 봄밤에디션 룰: 각 동물마다 1장의 왕카드 존재
                        // 프론트엔드 이미지 매핑을 위해 기본 정보 전달
                        img: `https://masi4882.dothome.co.kr/${useAnimals.findIndex(a => a.id === animal.id)}1.jpg?v=2026`
                    });
                }
            });

            // 3. 카드 섞기 (피셔-예이츠 셔플 알고리즘)
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            // 4. 플레이어 초기화 및 카드 분배
            room.players.forEach(p => {
                p.hand = [];
                p.penalties = [];
                p.handCount = 0;
            });

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

            // 5. 게임 상태 업데이트 및 클라이언트로 전송
            room.phase = 'GAME'; // 프론트엔드와 동일하게 'GAME'으로 맞춤
            room.turnId = room.players[0].id; // 방장부터 턴 시작

            pokerIo.to(roomCode).emit('gameStarted', room);
        }
    });
