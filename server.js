<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>바퀴벌레 포커: 얼티밋 마스터</title>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@900&family=Black+Han+Sans&family=Noto+Sans+KR:wght@700;900&display=swap" rel="stylesheet">
    <style>
        :root { --felt: #021a0d; --wood: #1a0f0a; --gold: #c5a059; --danger: #ff3e3e; --success: #4ade80; --attack: #3b82f6; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; color: white; font-family: 'Noto Sans KR', sans-serif; }
        
        .main-bg {
            width: 100vw;
            height: 100vh;
            background: linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url('https://masi4882.dothome.co.kr/main.jpg?v=2026') center/cover no-repeat;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
        }

        .full-table { width: 100vw; height: 100vh; background-color: var(--felt); background-image: radial-gradient(circle, rgba(10,50,30,0.3), #000 95%), url('https://www.transparenttextures.com/patterns/poker-qr-dark.png'); border: 22px solid var(--wood); box-sizing: border-box; position: relative; display: flex; align-items: center; justify-content: center; }
        
        .hud-status-bar { position: fixed; top: 0; left: 0; width: 100%; height: 50px; background: rgba(0,0,0,0.95); border-bottom: 2px solid var(--gold); display: flex; align-items: center; justify-content: center; z-index: 5000; }
        .status-text { font-family: 'Black Han Sans'; font-size: 18px; color: var(--gold); text-transform: uppercase; white-space: nowrap; }

        .player-node { position: absolute; width: 600px; z-index: 20; transition: all 0.5s ease; }
        .player-tag { background: rgba(0,0,0,0.95); border: 2px solid #333; border-radius: 10px; padding: 8px 15px; display: flex; justify-content: space-between; align-items: center; white-space: nowrap; transition: all 0.3s; }
        .active-turn .player-tag { border-color: var(--gold); box-shadow: 0 0 30px var(--gold); }
        .target-selectable { border-color: var(--attack) !important; cursor: pointer; animation: pulse 1.5s infinite; z-index: 3500 !important; }
        @keyframes pulse { 50% { box-shadow: 0 0 25px var(--attack); } }
        .is-receiver .player-tag { border-color: var(--danger) !important; box-shadow: 0 0 30px var(--danger); z-index: 100; }

        .penalty-shelf { display: flex; justify-content: center; gap: 5px; margin: 10px auto 0 auto; padding: 10px; background: rgba(0,0,0,0.5); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; width: max-content; max-width: 100%; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
        
        .mini-card { width: 44px; height: 64px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; position: relative; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.3s; overflow: hidden; }
        .mini-card.collected { background: #fdfcf0; border: 1.5px solid #000; opacity: 1; box-shadow: 0 4px 8px rgba(0,0,0,0.5); }
        .mini-card img { width: 100%; height: 100%; object-fit: cover; }
        
        .p-badge { position: absolute; top: -6px; right: -6px; background: var(--danger); color: #fff; font-size: 10px; font-weight: 900; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #000; box-shadow: 0 2px 4px rgba(0,0,0,0.5); z-index: 10; }

        .pos-l1 { top: 15%; left: 35px; } .pos-l2 { top: 46%; left: 35px; transform: translateY(-50%); } .pos-l3 { bottom: 250px; left: 35px; } .pos-l4 { top: 75%; left: 35px; transform: translateY(-50%); }
        .pos-r1 { top: 15%; right: 35px; } .pos-r2 { top: 46%; right: 35px; transform: translateY(-50%); } .pos-r3 { bottom: 250px; right: 35px; } .pos-r4 { top: 75%; right: 35px; transform: translateY(-50%); }
        .pos-top { top: 130px; left: 50%; transform: translateX(-50%); } .pos-top2 { top: 130px; left: 70%; transform: translateX(-50%); }
        .pos-me { bottom: 250px; left: 50%; transform: translateX(-50%); z-index: 50; }

        .hand-area { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); z-index: 90000 !important; display: flex; flex-direction: column; align-items: center; pointer-events: none; }
        .hand-tray { display: flex; padding: 30px 50px; overflow-x: visible; pointer-events: auto; }
        
        .h-card { flex: 0 0 90px; height: 135px; background: #fdfcf0; border: 3.5px solid #111; border-radius: 10px; margin-left: -15px; transition: all 0.25s ease; cursor: pointer; display: flex; flex-direction: column; box-shadow: 5px 0 15px rgba(0,0,0,0.4); overflow: hidden; position: relative; }
        .h-card:first-child { margin-left: 0; }
        .h-card:hover { transform: translateY(-50px) scale(1.15); z-index: 95000 !important; border-color: var(--gold); }
        .h-card.selected { border-color: var(--attack); transform: translateY(-70px); box-shadow: 0 0 35px var(--attack); }
        
        .h-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
        .card-name-overlay { position: absolute; bottom: 0; left: 0; width: 100%; background: #000000; color: #ffffff; font-size: 13px; letter-spacing: 1px; display: flex; align-items: center; justify-content: center; font-family: 'Black Han Sans'; padding: 5px 0; border-top: 2px solid #333333; z-index: 5; }

        .decision-ui { position: fixed; bottom: 250px; left: 50%; transform: translateX(-50%); display: flex; gap: 20px; z-index: 100000; pointer-events: auto; }
        .premium-btn { width: 180px; height: 75px; border-radius: 15px; border: 4px solid; font-family: 'Black Han Sans'; font-size: 26px; cursor: pointer; transition: all 0.2s; background: rgba(0,0,0,0.95); white-space: nowrap; color: white; }
        .premium-btn:hover { transform: scale(1.1) translateY(-5px); background: #000; }
        .btn-true { color: var(--success); border-color: var(--success); }
        .btn-lie { color: var(--danger); border-color: var(--danger); }
        .btn-pass { color: var(--attack); border-color: var(--attack); }

        .arena-bg { position: fixed; inset: 0; background: rgba(0,0,0,0); transition: background 0.5s ease; z-index: 100; pointer-events: none; }
        .arena-bg.dim { background: rgba(0,0,0,0.85); }
        .overlay-top { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 1000000; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: auto; }

        .card-container { perspective: 1000px; width: 180px; height: 260px; }
        .card-flipper { transition: transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275); transform-style: preserve-3d; width: 100%; height: 100%; position: relative; }
        .card-flipper.flipped { transform: rotateY(180deg); }
        .card-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; border-radius: 12px; box-shadow: 0 15px 35px rgba(0,0,0,0.7); overflow: hidden; }
        
        .card-front { transform: rotateY(180deg); background: #fdfcf0; border: 4px solid #111; display:flex; flex-direction:column; position: relative; }
        .card-front img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .card-front .card-name-overlay { font-size: 20px; padding: 8px 0; border-top: 3px solid #333333; }
        
        .card-back { background: #111; border: 8px solid var(--gold); background-image: radial-gradient(circle, var(--gold) 1px, transparent 1.5px), linear-gradient(45deg, transparent 48%, rgba(197, 160, 89, 0.3) 50%, transparent 52%), linear-gradient(-45deg, transparent 48%, rgba(197, 160, 89, 0.3) 50%, transparent 52%); background-size: 15px 15px; }
        
        @keyframes popIn { 0% { opacity: 0; transform: scale(0.5) translateY(50px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>
    <audio id="bgmAudio" loop preload="auto">
        <source src="https://masi4882.dothome.co.kr/kuromaku%20no%20kage-Narr.mp3" type="audio/mpeg">
    </audio>

    <div id="root"></div>

    <script type="text/babel">
        const { useState, useEffect } = React;
        const SERVER_URL = "https://bombam.onrender.com"; 
        
        const socket = io(SERVER_URL, { transports: ['polling', 'websocket'] });

        const sfxClick = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
        const sfxAction = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
        const sfxGameStart = new Audio('https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3'); 
        const sfxFlip = new Audio('https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3');
        const sfxWin = new Audio('https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3'); 
        const sfxLose = new Audio('https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3'); 
        const sfxHover = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');

        sfxClick.volume = 0.15; sfxAction.volume = 0.1; sfxGameStart.volume = 0.2; sfxFlip.volume = 0.2; sfxWin.volume = 0.2; sfxLose.volume = 0.2; 
        sfxHover.volume = 0.08;

        const playSound = (audio) => { try { audio.currentTime = 0; audio.play().catch(e => {}); } catch(e) {} };

        let bgmInstance = null;

        const SNAKE_IMAGES = [
            "https://masi4882.dothome.co.kr/90.jpg?v=2026", "https://masi4882.dothome.co.kr/91.jpg?v=2026",
            "https://masi4882.dothome.co.kr/92.jpg?v=2026", "https://masi4882.dothome.co.kr/93.jpg?v=2026",
            "https://masi4882.dothome.co.kr/94.jpg?v=2026", "https://masi4882.dothome.co.kr/95.jpg?v=2026",
            "https://masi4882.dothome.co.kr/96.jpg?v=2026", "https://masi4882.dothome.co.kr/97.jpg?v=2026",
            "https://masi4882.dothome.co.kr/98.jpg?v=2026", "https://masi4882.dothome.co.kr/99.jpg?v=2026"
        ];

        const MOSQUITO_IMAGES = [
            "https://masi4882.dothome.co.kr/80.jpg?v=2026", "https://masi4882.dothome.co.kr/81.jpg?v=2026",
            "https://masi4882.dothome.co.kr/82.jpg?v=2026", "https://masi4882.dothome.co.kr/83.jpg?v=2026",
            "https://masi4882.dothome.co.kr/84.jpg?v=2026", "https://masi4882.dothome.co.kr/85.jpg?v=2026",
            "https://masi4882.dothome.co.kr/86.jpg?v=2026", "https://masi4882.dothome.co.kr/87.jpg?v=2026",
            "https://masi4882.dothome.co.kr/88.jpg?v=2026", "https://masi4882.dothome.co.kr/89.jpg?v=2026"
        ];

        const FLY_IMAGES = [
            "https://masi4882.dothome.co.kr/70.jpg?v=2026", "https://masi4882.dothome.co.kr/71.jpg?v=2026",
            "https://masi4882.dothome.co.kr/72.jpg?v=2026", "https://masi4882.dothome.co.kr/73.jpg?v=2026",
            "https://masi4882.dothome.co.kr/74.jpg?v=2026", "https://masi4882.dothome.co.kr/75.jpg?v=2026",
            "https://masi4882.dothome.co.kr/76.jpg?v=2026", "https://masi4882.dothome.co.kr/77.jpg?v=2026",
            "https://masi4882.dothome.co.kr/78.jpg?v=2026", "https://masi4882.dothome.co.kr/79.jpg?v=2026"
        ];

        const RAT_IMAGES = [
            "https://masi4882.dothome.co.kr/60.jpg?v=2026", "https://masi4882.dothome.co.kr/61.jpg?v=2026",
            "https://masi4882.dothome.co.kr/62.jpg?v=2026", "https://masi4882.dothome.co.kr/63.jpg?v=2026",
            "https://masi4882.dothome.co.kr/64.jpg?v=2026", "https://masi4882.dothome.co.kr/65.jpg?v=2026",
            "https://masi4882.dothome.co.kr/66.jpg?v=2026", "https://masi4882.dothome.co.kr/67.jpg?v=2026",
            "https://masi4882.dothome.co.kr/68.jpg?v=2026", "https://masi4882.dothome.co.kr/69.jpg?v=2026"
        ];

        const BAT_IMAGES = [
            "https://masi4882.dothome.co.kr/50.jpg?v=2026", "https://masi4882.dothome.co.kr/51.jpg?v=2026",
            "https://masi4882.dothome.co.kr/52.jpg?v=2026", "https://masi4882.dothome.co.kr/53.jpg?v=2026",
            "https://masi4882.dothome.co.kr/54.jpg?v=2026", "https://masi4882.dothome.co.kr/55.jpg?v=2026",
            "https://masi4882.dothome.co.kr/56.jpg?v=2026", "https://masi4882.dothome.co.kr/57.jpg?v=2026",
            "https://masi4882.dothome.co.kr/58.jpg?v=2026", "https://masi4882.dothome.co.kr/59.jpg?v=2026"
        ];

        const SCORPION_IMAGES = [
            "https://masi4882.dothome.co.kr/40.jpg?v=2026", "https://masi4882.dothome.co.kr/41.jpg?v=2026",
            "https://masi4882.dothome.co.kr/42.jpg?v=2026", "https://masi4882.dothome.co.kr/43.jpg?v=2026",
            "https://masi4882.dothome.co.kr/44.jpg?v=2026", "https://masi4882.dothome.co.kr/45.jpg?v=2026",
            "https://masi4882.dothome.co.kr/46.jpg?v=2026", "https://masi4882.dothome.co.kr/47.jpg?v=2026",
            "https://masi4882.dothome.co.kr/48.jpg?v=2026", "https://masi4882.dothome.co.kr/49.jpg?v=2026"
        ];

        const COCKROACH_IMAGES = [
            "https://masi4882.dothome.co.kr/30.jpg?v=2026", "https://masi4882.dothome.co.kr/31.jpg?v=2026",
            "https://masi4882.dothome.co.kr/32.jpg?v=2026", "https://masi4882.dothome.co.kr/33.jpg?v=2026",
            "https://masi4882.dothome.co.kr/34.jpg?v=2026", "https://masi4882.dothome.co.kr/35.jpg?v=2026",
            "https://masi4882.dothome.co.kr/36.jpg?v=2026", "https://masi4882.dothome.co.kr/37.jpg?v=2026",
            "https://masi4882.dothome.co.kr/38.jpg?v=2026", "https://masi4882.dothome.co.kr/39.jpg?v=2026"
        ];

        const SPIDER_IMAGES = [
            "https://masi4882.dothome.co.kr/00.jpg?v=2026", "https://masi4882.dothome.co.kr/01.jpg?v=2026",
            "https://masi4882.dothome.co.kr/02.jpg?v=2026", "https://masi4882.dothome.co.kr/03.jpg?v=2026",
            "https://masi4882.dothome.co.kr/04.jpg?v=2026", "https://masi4882.dothome.co.kr/05.jpg?v=2026",
            "https://masi4882.dothome.co.kr/06.jpg?v=2026", "https://masi4882.dothome.co.kr/07.jpg?v=2026",
            "https://masi4882.dothome.co.kr/08.jpg?v=2026", "https://masi4882.dothome.co.kr/09.jpg?v=2026"
        ];

        const STINKBUG_IMAGES = [
            "https://masi4882.dothome.co.kr/10.jpg?v=2026", "https://masi4882.dothome.co.kr/11.jpg?v=2026",
            "https://masi4882.dothome.co.kr/12.jpg?v=2026", "https://masi4882.dothome.co.kr/13.jpg?v=2026",
            "https://masi4882.dothome.co.kr/14.jpg?v=2026", "https://masi4882.dothome.co.kr/15.jpg?v=2026",
            "https://masi4882.dothome.co.kr/16.jpg?v=2026", "https://masi4882.dothome.co.kr/17.jpg?v=2026",
            "https://masi4882.dothome.co.kr/18.jpg?v=2026", "https://masi4882.dothome.co.kr/19.jpg?v=2026"
        ];

        const TOAD_IMAGES = [
            "https://masi4882.dothome.co.kr/20.jpg?v=2026", "https://masi4882.dothome.co.kr/21.jpg?v=2026",
            "https://masi4882.dothome.co.kr/22.jpg?v=2026", "https://masi4882.dothome.co.kr/23.jpg?v=2026",
            "https://masi4882.dothome.co.kr/24.jpg?v=2026", "https://masi4882.dothome.co.kr/25.jpg?v=2026",
            "https://masi4882.dothome.co.kr/26.jpg?v=2026", "https://masi4882.dothome.co.kr/27.jpg?v=2026",
            "https://masi4882.dothome.co.kr/28.jpg?v=2026", "https://masi4882.dothome.co.kr/29.jpg?v=2026"
        ];

        const BASE_ANIMALS = [
            { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://masi4882.dothome.co.kr/30.jpg?v=2026' },
            { id: 'bat', name: '박쥐', color: '#334155', img: 'https://masi4882.dothome.co.kr/50.jpg?v=2026' },
            { id: 'fly', name: '파리', color: '#15803d', img: 'https://masi4882.dothome.co.kr/70.jpg?v=2026' },
            { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://masi4882.dothome.co.kr/20.jpg?v=2026' },
            { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://masi4882.dothome.co.kr/40.jpg?v=2026' },
            { id: 'rat', name: '쥐', color: '#57534e', img: 'https://masi4882.dothome.co.kr/60.jpg?v=2026' },
            { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://masi4882.dothome.co.kr/00.jpg?v=2026' },
            { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://masi4882.dothome.co.kr/10.jpg?v=2026' }
        ];

        const EXTENDED_ANIMALS = [
            { id: 'cockroach', name: '바퀴벌레', color: '#78350f', img: 'https://masi4882.dothome.co.kr/30.jpg?v=2026' },
            { id: 'bat', name: '박쥐', color: '#334155', img: 'https://masi4882.dothome.co.kr/50.jpg?v=2026' },
            { id: 'spider', name: '거미', color: '#1e1b4b', img: 'https://masi4882.dothome.co.kr/00.jpg?v=2026' },
            { id: 'stinkbug', name: '노린재', color: '#854d0e', img: 'https://masi4882.dothome.co.kr/10.jpg?v=2026' },
            { id: 'toad', name: '두꺼비', color: '#065f46', img: 'https://masi4882.dothome.co.kr/20.jpg?v=2026' },
            { id: 'scorpion', name: '전갈', color: '#991b1b', img: 'https://masi4882.dothome.co.kr/40.jpg?v=2026' },
            { id: 'rat', name: '쥐', color: '#57534e', img: 'https://masi4882.dothome.co.kr/60.jpg?v=2026' },
            { id: 'fly', name: '파리', color: '#15803d', img: 'https://masi4882.dothome.co.kr/70.jpg?v=2026' },
            { id: 'mosquito', name: '모기', color: '#dc2626', img: 'https://masi4882.dothome.co.kr/80.jpg?v=2026' },
            { id: 'snake', name: '뱀', color: '#16a34a', img: 'https://masi4882.dothome.co.kr/90.jpg?v=2026' }
        ];

        function App() {
            const [view, setView] = useState('JOIN');
            const [room, setRoom] = useState(null);
            const [myHand, setMyHand] = useState([]);
            const [phase, setPhase] = useState('IDLE');
            const [userName, setUserName] = useState('');
            const [roomCode, setRoomCode] = useState('');
            const [selectedCard, setSelectedCard] = useState(null);
            const [status, setStatus] = useState('OFFLINE');
            const [selectedTargetId, setSelectedTargetId] = useState(null);
            const [bgmPlaying, setBgmPlaying] = useState(false);
            const [isReady, setIsReady] = useState(false);
            const [userOffBgm, setUserOffBgm] = useState(false);

            const activeAnimals = (room?.players?.length >= 7) ? EXTENDED_ANIMALS : BASE_ANIMALS;

            const triggerAudioPlay = () => {
                if (userOffBgm) return;
                const audio = document.getElementById('bgmAudio');
                if (audio) {
                    audio.volume = 0.00875;
                    audio.play().then(() => {
                        setBgmPlaying(true);
                    }).catch(e => {});
                }
            };

            const toggleBGM = (e) => {
                if (e) e.stopPropagation();
                const audio = document.getElementById('bgmAudio');
                if (!audio) return;

                audio.volume = 0.00875;
                if (bgmPlaying) {
                    audio.pause();
                    setBgmPlaying(false);
                    setUserOffBgm(true);
                } else {
                    audio.play().then(() => {
                        setBgmPlaying(true);
                        setUserOffBgm(false);
                    }).catch(err => {
                        console.log("Play failed", err);
                    });
                }
            };

            const handleToggleReady = () => {
                playSound(sfxClick);
                const nextReady = !isReady;
                setIsReady(nextReady);
                
                // 로컬 룸 데이터에서도 즉시 반영 (낙관적 UI 업데이트)
                if (room && room.players) {
                    const updatedPlayers = room.players.map(p => p.id === socket.id ? { ...p, ready: nextReady } : p);
                    setRoom({ ...room, players: updatedPlayers });
                }

                socket.emit('playerReady', { roomCode, ready: nextReady });
            };

            useEffect(() => {
                const handleFirstInteract = () => {
                    triggerAudioPlay();
                    window.removeEventListener('click', handleFirstInteract);
                    window.removeEventListener('touchstart', handleFirstInteract);
                };
                window.addEventListener('click', handleFirstInteract);
                window.addEventListener('touchstart', handleFirstInteract);

                socket.on('connect', () => setStatus('ONLINE'));
                socket.on('disconnect', () => setStatus('OFFLINE'));
                socket.on('roomUpdate', data => { 
                    setRoom(data);
                    const me = data.players?.find(p => p.id === socket.id);
                    if (me && typeof me.ready === 'boolean') {
                        setIsReady(me.ready);
                    }
                    setView(prev => (prev === 'JOIN' ? 'LOBBY' : prev)); 
                });
                socket.on('gameStarted', data => { 
                    setRoom(data); 
                    setPhase('IDLE'); 
                    setSelectedCard(null);
                    setSelectedTargetId(null);
                    setView('GAME'); 
                    
                    const audio = document.getElementById('bgmAudio');
                    if(audio) {
                        audio.pause();
                        audio.currentTime = 0;
                        setBgmPlaying(false);
                        setUserOffBgm(true);
                    }
                });
                socket.on('onOffer', data => { 
                    setRoom(data); 
                    setPhase('RESPONSE'); 
                    setSelectedCard(null);
                    setSelectedTargetId(null);
                });
                socket.on('roundResolved', data => { 
                    setRoom(data); 
                    setPhase('IDLE'); 
                    setSelectedCard(null);
                    setSelectedTargetId(null);
                });
                socket.on('revealStart', data => {
                    setRoom(data);
                    setPhase('REVEAL');
                    playSound(sfxFlip); 
                    setTimeout(() => {
                        if(data.revealData?.guessCorrect) playSound(sfxWin);
                        else playSound(sfxLose);
                    }, 700);
                });
            }, []);

            useEffect(() => {
                if (room && room.players) {
                    const me = room.players.find(p => p.id === socket.id);
                    if (me && me.hand) setMyHand(me.hand);
                }
            }, [room]);

            const join = () => {
                if(!userName.trim() || !roomCode.trim()) return alert("닉네임과 방 코드를 모두 입력해주세요!");
                if(status === 'OFFLINE') return alert("서버 연결 대기중입니다.");
                socket.emit('joinRoom', { roomCode, userName });
                playSound(sfxClick);
            };
            
            const start = () => {
                const nonHostPlayers = room?.players?.slice(1) || [];
                const allReady = nonHostPlayers.every(p => p.ready);
                
                if (nonHostPlayers.length > 0 && !allReady) {
                    alert("모든 플레이어가 '준비 완료' 상태여야 게임을 시작할 수 있습니다!");
                    return;
                }

                socket.emit('startGame', roomCode);
                playSound(sfxGameStart); 
            };

            const handlePickCard = (card) => { 
                if(room?.turnId === socket.id && (phase === 'IDLE' || phase === 'TARGET')) { 
                    playSound(sfxClick);
                    if (selectedCard?.inst === card.inst) {
                        setSelectedCard(null);
                        setPhase('IDLE');
                    } else {
                        setSelectedCard(card);
                        setPhase('TARGET');
                    }
                } 
            };
            
            const handlePickTarget = (id) => { 
                if(phase === 'TARGET' || phase === 'PASS_TARGET') { 
                    playSound(sfxClick);
                    setSelectedTargetId(id); 
                    setPhase('CLAIM_SELECT'); 
                }
            };

            const handleDeclare = (animal) => {
                playSound(sfxAction);
                if(phase === 'CLAIM_SELECT' && !room?.activeOffer) {
                    socket.emit('submitOffer', { roomCode, targetId: selectedTargetId, card: selectedCard, claim: animal.name });
                } else {
                    socket.emit('submitPass', { roomCode, nextTargetId: selectedTargetId, newClaim: animal.name });
                }
                setSelectedCard(null); 
                setSelectedTargetId(null);
                setPhase('IDLE');
            };

            const getCardImg = (c) => {
                const key = c.inst || Math.random().toString();
                let hash = 0;
                for (let i = 0; i < key.length; i++) {
                    hash = key.charCodeAt(i) + ((hash << 5) - hash);
                }
                const idx = Math.abs(hash) % 10;

                if (c.id === 'snake') return SNAKE_IMAGES[idx];
                if (c.id === 'mosquito') return MOSQUITO_IMAGES[idx];
                if (c.id === 'fly') return FLY_IMAGES[idx];
                if (c.id === 'rat') return RAT_IMAGES[idx];
                if (c.id === 'bat') return BAT_IMAGES[idx];
                if (c.id === 'cockroach') return COCKROACH_IMAGES[idx];
                if (c.id === 'spider') return SPIDER_IMAGES[idx];
                if (c.id === 'stinkbug') return STINKBUG_IMAGES[idx];
                if (c.id === 'toad') return TOAD_IMAGES[idx];
                if (c.id === 'scorpion') return SCORPION_IMAGES[idx];
                return c.img;
            };

            const getPosClass = (idx) => {
                if (idx <= 0) return "pos-me";
                const classes = ["pos-l1", "pos-l2", "pos-l3", "pos-top", "pos-r1", "pos-r2", "pos-r3", "pos-l4", "pos-r4", "pos-top2"];
                return classes[idx - 1] || "pos-top";
            };

            const getCardPosStyle = (posClass) => {
                const pos = posClass || 'pos-top';
                const base = { position: 'absolute', zIndex: 60000 };
                switch(pos) {
                    case 'pos-me': return { ...base, bottom: '340px', left: '50%', transform: 'translateX(-50%)' };
                    case 'pos-l1': return { ...base, top: '20%', left: '320px' };
                    case 'pos-l2': return { ...base, top: '50%', left: '320px', transform: 'translateY(-50%)' };
                    case 'pos-l3': return { ...base, bottom: '260px', left: '320px' };
                    case 'pos-l4': return { ...base, top: '75%', left: '320px', transform: 'translateY(-50%)' };
                    case 'pos-r1': return { ...base, top: '20%', right: '320px' };
                    case 'pos-r2': return { ...base, top: '50%', right: '320px', transform: 'translateY(-50%)' };
                    case 'pos-r3': return { ...base, bottom: '260px', right: '320px' };
                    case 'pos-r4': return { ...base, top: '75%', right: '320px', transform: 'translateY(-50%)' };
                    case 'pos-top': return { ...base, top: '200px', left: '50%', transform: 'translateX(-50%)' };
                    case 'pos-top2': return { ...base, top: '200px', left: '70%', transform: 'translateX(-50%)' };
                    default: return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
                }
            };

            const getBannerPosStyle = (posClass) => {
                const pos = posClass || 'pos-top';
                const base = { position: 'absolute', zIndex: 50000, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 'max-content' };
                switch(pos) {
                    case 'pos-me': return { ...base, bottom: '630px', left: '50%', transform: 'translateX(-50%)' };
                    case 'pos-top': 
                    case 'pos-top2': return { ...base, top: '490px', left: '50%', transform: 'translateX(-50%)' };
                    case 'pos-l1': return { ...base, top: '20%', left: '530px' };
                    case 'pos-l2': return { ...base, top: '50%', left: '530px', transform: 'translateY(-50%)' };
                    case 'pos-l3': return { ...base, bottom: '260px', left: '530px' };
                    case 'pos-l4': return { ...base, top: '75%', left: '530px', transform: 'translateY(-50%)' };
                    case 'pos-r1': return { ...base, top: '20%', right: '530px' };
                    case 'pos-r2': return { ...base, top: '50%', right: '530px', transform: 'translateY(-50%)' };
                    case 'pos-r3': return { ...base, bottom: '260px', right: '530px' };
                    case 'pos-r4': return { ...base, top: '75%', right: '530px', transform: 'translateY(-50%)' };
                    default: return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
                }
            };

            if (view === 'JOIN') return (
                <div className="main-bg" onClick={triggerAudioPlay}>
                    <div className="mb-4 flex items-center justify-center gap-2">
                        <div className={`w-4 h-4 rounded-full ${status === 'ONLINE' ? 'bg-green-500 animate-pulse shadow-[0_0_15px_#4ade80]' : 'bg-red-500'}`}></div>
                        <span className={`text-sm font-bold tracking-widest ${status === 'ONLINE' ? 'text-green-400' : 'text-red-400'}`}>
                            {status === 'ONLINE' ? 'SERVER ONLINE' : 'SERVER OFFLINE'}
                        </span>
                    </div>

                    <div className="relative w-[450px] max-w-full">
                        <div className="absolute -top-10 right-0 z-50">
                            <button type="button" onClick={toggleBGM} className="text-xs text-yellow-300 bg-black/80 hover:bg-black border border-yellow-500 px-3 py-1.5 rounded-full shadow-lg transition-all font-bold cursor-pointer" style={{ opacity: 0.5 }}>
                                {bgmPlaying ? "🔊 BGM 끄기" : "🎵 BGM 켜기"}
                            </button>
                        </div>

                        <div className="bg-zinc-900/90 backdrop-blur-md p-10 text-center border-t-4 border-yellow-600 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-x border-b border-zinc-800" onClick={e => e.stopPropagation()}>
                            <h1 className="text-4xl sm:text-5xl text-yellow-400 mb-8 font-black tracking-wide whitespace-nowrap drop-shadow-[0_4px_15px_rgba(234,179,8,0.5)]" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                바퀴벌레 포커
                            </h1>
                            <input className="w-full bg-zinc-800/80 p-3.5 rounded-xl mb-4 text-white outline-none border border-zinc-700 placeholder-zinc-500 focus:border-yellow-500 transition-all font-medium" placeholder="닉네임 (예: 홍길동)" value={userName} onChange={e=>setUserName(e.target.value)} onClick={triggerAudioPlay} />
                            <input className="w-full bg-zinc-800/80 p-3.5 rounded-xl mb-8 text-white outline-none border border-zinc-700 placeholder-zinc-500 focus:border-yellow-500 transition-all font-medium" placeholder="방 코드 (예: 1234)" value={roomCode} onChange={e=>setRoomCode(e.target.value)} onClick={triggerAudioPlay} />
                            <button onClick={() => { triggerAudioPlay(); join(); }} className="bg-yellow-600 w-full py-4 rounded-xl text-xl text-black font-black transition-all hover:bg-yellow-500 hover:scale-[1.02] shadow-lg" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>입장하기</button>
                        </div>
                    </div>
                </div>
            );

            if (view === 'LOBBY') return (
                <div className="main-bg" onClick={triggerAudioPlay}>
                    <div className="absolute top-6 right-8 z-50">
                        <button type="button" onClick={toggleBGM} className="text-xs text-yellow-300 bg-black/80 hover:bg-black border border-yellow-500 px-3.5 py-2 rounded-full shadow-lg transition-all font-bold cursor-pointer" style={{ opacity: 0.5 }}>
                            {bgmPlaying ? "🔊 BGM 끄기" : "🎵 BGM 켜기"}
                        </button>
                    </div>

                    <div className="bg-zinc-950/95 backdrop-blur-xl p-10 md:p-12 rounded-[35px] border-[5px] border-yellow-600/90 shadow-[0_25px_70px_rgba(0,0,0,0.95)] w-[480px] max-w-[92vw] text-center z-20 flex flex-col items-center" onClick={e => e.stopPropagation()}>
                        <h2 className="text-3xl md:text-4xl text-yellow-400 font-black mb-1 tracking-wider drop-shadow-[0_0_15px_rgba(234,179,8,0.4)]" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                            ROOM: {roomCode}
                        </h2>
                        {room?.players?.length >= 2 && (
                            <div className="text-blue-400 font-black text-lg mb-2">
                                {room.players.length}인 플레이
                            </div>
                        )}
                        <p className="text-zinc-400 text-sm mb-6 font-medium">참가자가 모두 준비되면 방장이 게임을 시작합니다</p>

                        <div className="bg-black/80 p-4 rounded-2xl border-2 border-zinc-800/80 w-full mb-8 max-h-[300px] overflow-y-auto shadow-inner flex flex-col gap-2.5">
                            {room?.players?.map((p, idx) => {
                                const isHost = idx === 0;
                                const isMe = p.id === socket.id;

                                return (
                                    <div key={p.id} className={`px-4 py-3 rounded-xl border flex items-center justify-between transition-all ${isHost ? 'bg-yellow-950/30 border-yellow-600/60 shadow-[0_0_10px_rgba(202,138,4,0.2)]' : 'bg-zinc-900/70 border-zinc-800'}`} style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                        <div className="flex items-center gap-3">
                                            <span className="text-xl">{isHost ? '👑' : '👤'}</span>
                                            <span className="text-white font-bold text-base tracking-wide">
                                                {p.name}
                                                {isMe && <span className="ml-2 text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded border border-blue-500/40">나</span>}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {!isHost && (
                                                <span className={`text-xs px-2.5 py-1 rounded-full font-black flex items-center gap-1 ${p.ready ? 'bg-green-500/20 text-green-400 border border-green-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                                                    {p.ready ? '✅ 준비 완료' : '⏳ 대기 중'}
                                                </span>
                                            )}
                                            {isHost && <span className="text-xs bg-yellow-500 text-black px-2.5 py-0.5 rounded-full font-black">방장</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex gap-4 w-full">
                            <button onClick={() => { playSound(sfxClick); window.location.reload(); }} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-4 rounded-xl font-black text-lg transition-all shadow-lg border border-zinc-700 cursor-pointer" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                나가기
                            </button>
                            
                            {room?.players?.[0]?.id !== socket.id && (
                                <button onClick={handleToggleReady} className={`flex-1 py-4 rounded-xl font-black text-xl transition-all shadow-lg cursor-pointer border ${isReady ? 'bg-zinc-800 text-zinc-300 border-zinc-600 hover:bg-zinc-700' : 'bg-green-600 text-white border-green-500 hover:bg-green-500 shadow-[0_0_20px_rgba(34,197,94,0.4)]'}`} style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                    {isReady ? '준비 취소' : '준비하기 ✨'}
                                </button>
                            )}

                            {room?.players?.[0]?.id === socket.id && (() => {
                                const nonHostPlayers = room?.players?.slice(1) || [];
                                const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every(p => p.ready);
                                
                                return (
                                    <button onClick={start} className={`flex-1 py-4 rounded-xl font-black text-xl transition-all shadow-lg cursor-pointer border ${allReady ? 'bg-yellow-600 text-black border-yellow-500 hover:bg-yellow-500 hover:scale-[1.02] shadow-[0_0_20px_rgba(202,138,4,0.5)]' : 'bg-zinc-800 text-zinc-500 border-zinc-700 opacity-60 cursor-not-allowed'}`} style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                        게임 시작 🚀
                                    </button>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            );

            if (!room || !room.players) return <div className="text-white text-center mt-20 text-2xl font-bold animate-pulse" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>데이터를 불러오는 중...</div>;

            if (room.phase === 'GAME_OVER') {
                const loser = room.players.find(p => p.id === room.loserId);
                const winners = room.players.filter(p => p.id !== room.loserId);

                return (
                    <div className="fixed inset-0 z-[1000000] flex flex-col items-center justify-center bg-black bg-[url('https://www.transparenttextures.com/patterns/poker-qr-dark.png')] p-4">
                        <div className="bg-zinc-900/95 p-10 md:p-14 rounded-[40px] border-[6px] border-red-900 shadow-[0_0_150px_rgba(220,38,38,0.6)] text-center flex flex-col items-center max-w-[800px] w-full">
                            <h1 className="text-7xl md:text-8xl text-red-500 font-black mb-6 animate-pulse font-[Cinzel] tracking-widest drop-shadow-[0_0_20px_rgba(239,68,68,0.8)]">
                                GAME OVER
                            </h1>
                            <div className="bg-black/60 p-6 rounded-3xl border border-red-800/50 w-full mb-10 shadow-inner">
                                <h2 className="text-4xl md:text-5xl text-white mb-3" style={{fontFamily: "'Noto Sans KR', sans-serif", fontWeight: '900'}}>
                                    <span className="text-yellow-400 text-5xl md:text-6xl mx-2">[{loser?.name}]</span> 님의 패배! 💀
                                </h2>
                                <p className="text-red-400 text-lg md:text-xl font-bold" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                    (동일한 벌칙 카드 4장 누적 또는 손패 고갈)
                                </p>
                            </div>
                            <div className="w-full bg-green-950/30 p-6 rounded-3xl border border-green-800/50">
                                <h3 className="text-3xl md:text-4xl text-green-400 font-black mb-6 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                    🎉 나머지 플레이어 승리! 🎉
                                </h3>
                                <div className="flex flex-wrap justify-center gap-3 md:gap-4">
                                    {winners.map(w => (
                                        <span key={w.id} className="bg-green-900/80 border-2 border-green-500 text-green-100 px-5 py-2 md:py-3 rounded-full font-bold text-lg md:text-xl shadow-[0_0_15px_rgba(34,197,94,0.4)]" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                            🏆 {w.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className="mt-12">
                                <button onClick={() => { playSound(sfxClick); window.location.reload(); }} className="bg-zinc-700 text-white px-12 py-5 rounded-full font-black text-2xl hover:bg-zinc-600 transition-all shadow-2xl border-4 border-zinc-500 hover:scale-105" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                    로비로 돌아가기
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            const myIdx = room.players.findIndex(p => p.id === socket.id);
            const safeMyIdx = myIdx >= 0 ? myIdx : 0;
            const orderedPlayers = [...room.players.slice(safeMyIdx), ...room.players.slice(0, safeMyIdx)];

            const currentAttackerName = room.activeOffer ? (room.players.find(p => p.id === room.activeOffer.seenIds?.[room.activeOffer.seenIds.length - 1])?.name || room.players.find(p => p.id === room.turnId)?.name) : '';
            const currentReceiverName = room.activeOffer ? (room.players.find(p => p.id === room.activeOffer.receiverId)?.name || '') : '';
            
            const currentTurnPlayer = room.players.find(p => p.id === room.turnId);
            const currentTurnName = currentTurnPlayer ? (currentTurnPlayer.id === socket.id ? "본인(나)" : currentTurnPlayer.name) : "상대방";

            return (
                <div className="full-table">
                    <div className="absolute top-3 right-4 z-[6000]">
                        <button type="button" onClick={toggleBGM} className="text-xs text-yellow-300 bg-black/80 hover:bg-black border border-yellow-500 px-3 py-1.5 rounded-full shadow-lg transition-all font-bold cursor-pointer" style={{ opacity: 0.7 }}>
                            {bgmPlaying ? "🔊 BGM 끄기" : "🎵 BGM 켜기"}
                        </button>
                    </div>

                    <div className="hud-status-bar"><span className="status-text uppercase" style={{fontFamily: "'Noto Sans KR', sans-serif", fontWeight: "900"}}>
                        {phase === 'IDLE' && (room.turnId === socket.id ? "공격할 카드를 선택하세요" : `${currentTurnName}님의 차례입니다`)}
                        {phase === 'TARGET' && "상대방을 테이블에서 클릭하세요"}
                        {phase === 'PASS_TARGET' && "넘길 대상을 선택하세요"}
                        {phase === 'CLAIM_SELECT' && "무엇으로 속이겠습니까?"}
                        {room.phase === 'RESPONSE' && phase !== 'PASS_TARGET' && `${currentAttackerName}님이 ${currentReceiverName}님께 카드를 건넵니다.`}
                        {room.phase === 'REVEAL' && "결과 확인!"}
                    </span></div>
                    
                    <div className={`arena-bg ${((room.phase === 'RESPONSE' && phase !== 'PASS_TARGET') || phase === 'CLAIM_SELECT' || room.phase === 'REVEAL') ? 'dim active' : ''}`}></div>

                    {orderedPlayers.map((p, i) => {
                        const isSeenAlready = phase === 'PASS_TARGET' && room?.activeOffer?.seenIds?.includes(p.id);
                        const targetable = (phase === 'TARGET' && p.id !== socket.id) || (phase === 'PASS_TARGET' && p.id !== socket.id && !isSeenAlready);
                        
                        return (
                            <div key={p.id} className={`player-node ${getPosClass(i)} ${room.turnId === p.id ? 'active-turn' : ''} ${room.activeOffer?.receiverId === p.id ? 'is-receiver' : ''} ${isSeenAlready ? 'opacity-30 grayscale pointer-events-none' : 'transition-all duration-300'}`}>
                                <div onClick={() => targetable && handlePickTarget(p.id)} className={`player-tag ${targetable ? 'target-selectable' : ''}`}>
                                    <span className="font-black text-yellow-500 uppercase" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>{p.name} {p.id === socket.id && "(나)"}</span>
                                    <span className="text-[11px] font-black text-zinc-400 ml-4" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>H: {p.handCount || 0}</span>
                                </div>
                                <div className="penalty-shelf">
                                    {activeAnimals.map(a => { 
                                        const count = (p.penalties || []).filter(pc => pc.id === a.id).length; 
                                        return (
                                            <div key={a.id} className={`mini-card ${count > 0 ? 'collected' : ''}`} style={{borderColor: a.color, opacity: count > 0 ? 1 : 0.1}}>
                                                {count > 0 && <img src={a.id === 'snake' ? SNAKE_IMAGES[0] : (a.id === 'mosquito' ? MOSQUITO_IMAGES[0] : (a.id === 'fly' ? FLY_IMAGES[0] : (a.id === 'rat' ? RAT_IMAGES[0] : (a.id === 'bat' ? BAT_IMAGES[0] : (a.id === 'cockroach' ? COCKROACH_IMAGES[0] : (a.id === 'spider' ? SPIDER_IMAGES[0] : (a.id === 'stinkbug' ? STINKBUG_IMAGES[0] : (a.id === 'toad' ? TOAD_IMAGES[0] : (a.id === 'scorpion' ? SCORPION_IMAGES[0] : a.img)))))))))} />}
                                                {count > 1 && <div className="p-badge">{count}</div>}
                                            </div>
                                        ); 
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    {(room.phase === 'RESPONSE' || room.phase === 'REVEAL') && room.activeOffer && phase !== 'PASS_TARGET' && (() => {
                        const receiverIndex = orderedPlayers.findIndex(p => p.id === room.activeOffer.receiverId);
                        const receiverPosClass = getPosClass(receiverIndex);

                        return (
                            <div style={getBannerPosStyle(receiverPosClass)} className="drop-shadow-2xl">
                                {room.phase === 'RESPONSE' && (
                                    <div className="text-xl md:text-2xl font-black drop-shadow-[0_0_15px_rgba(202,138,4,1)] animate-bounce bg-black/90 backdrop-blur-md px-6 py-4 rounded-full border-4 border-yellow-500 text-center whitespace-nowrap" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                        <span className="text-white">{currentAttackerName}</span> 님이<br/>
                                        <span className="text-blue-300">{currentReceiverName}</span> 님에게 
                                        <span className="text-red-400 text-2xl md:text-3xl"> [{room.activeOffer.claim}] </span> (이)라고 건넸습니다!
                                    </div>
                                )}

                                {room.phase === 'REVEAL' && room.revealData && (
                                    <div className="flex flex-col items-center animate-[fadeIn_0.5s_ease-in-out] whitespace-nowrap" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                        <div className={`text-4xl md:text-5xl font-black mb-3 ${room.revealData.guessCorrect ? 'text-green-400 drop-shadow-[0_0_25px_rgba(74,222,128,1)]' : 'text-red-500 drop-shadow-[0_0_25px_rgba(239,68,68,1)]'}`}>
                                            {room.revealData.guessCorrect ? "예측 성공! 🎉" : "예측 실패! 💀"}
                                        </div>
                                        <div className="text-lg md:text-xl text-white bg-black/95 backdrop-blur-lg px-6 py-4 rounded-2xl border-4 border-gray-600 text-center shadow-2xl">
                                            건넨 카드는 <span className="text-yellow-400 font-bold text-xl md:text-2xl mx-2">[{room.revealData.actualCard.name}]</span> 였습니다!<br/>
                                            <div className="mt-2 border-t border-gray-700 pt-2">👉 <span className="text-blue-300 font-bold text-xl md:text-2xl">{room.players.find(p => p.id === room.revealData.penaltyId)?.name}</span> 님이 벌칙 카드를 받습니다.</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {(room.phase === 'RESPONSE' || room.phase === 'REVEAL') && room.activeOffer && phase !== 'PASS_TARGET' && (() => {
                        const receiverIndex = orderedPlayers.findIndex(p => p.id === room.activeOffer.receiverId);
                        const receiverPosClass = getPosClass(receiverIndex);
                        
                        return (
                            <div style={getCardPosStyle(receiverPosClass)} className="pointer-events-none">
                                <div className="animate-[popIn_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)_forwards]">
                                    <div className="card-container">
                                        <div className={`card-flipper ${room.phase === 'REVEAL' ? 'flipped' : ''}`}>
                                            <div className="card-face card-back"></div>
                                            <div className="card-face card-front" style={{borderColor: room.activeOffer.card.color}}>
                                                <img src={getCardImg(room.activeOffer.card)} alt="card" />
                                                <div className="card-name-overlay">
                                                    {room.activeOffer.card.name}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {room.phase === 'RESPONSE' && room.activeOffer?.receiverId === socket.id && phase !== 'PASS_TARGET' && phase !== 'CLAIM_SELECT' && (
                        <div className="decision-ui">
                            <button onClick={() => { playSound(sfxAction); socket.emit('resolveResponse', { roomCode, guessIsTrue: true }); }} className="premium-btn btn-true shadow-2xl">진실</button>
                            <button onClick={() => { playSound(sfxAction); socket.emit('resolveResponse', { roomCode, guessIsTrue: false }); }} className="premium-btn btn-lie shadow-2xl">거짓</button>
                            {room.activeOffer.seenIds.length < room.players.length - 1 && (
                                <button onClick={() => { playSound(sfxClick); setPhase('PASS_TARGET'); }} className="premium-btn btn-pass shadow-2xl">넘기기</button>
                            )}
                        </div>
                    )}

                    {phase === 'PASS_TARGET' && (
                        <div className="fixed bottom-[200px] left-1/2 -translate-x-1/2 flex flex-col items-center z-[100000] pointer-events-auto">
                            <div className="text-3xl text-blue-400 font-black mb-6 drop-shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-pulse border-4 border-blue-500 bg-black/80 px-8 py-3 rounded-full" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                카드를 넘길 대상을 클릭하세요!
                            </div>
                            <button onClick={() => { playSound(sfxClick); setPhase('RESPONSE'); }} className="premium-btn bg-zinc-800 border-zinc-500 text-gray-300 shadow-2xl text-xl h-[60px]" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>
                                ❌ 취소 (돌아가기)
                            </button>
                        </div>
                    )}

                    {phase === 'CLAIM_SELECT' && (
                        <div className="overlay-top">
                            <p className="text-yellow-500 font-black text-4xl mb-12 uppercase" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>블러핑: 동물을 선택하세요</p>
                            <div className={`grid ${activeAnimals.length > 8 ? 'grid-cols-5' : 'grid-cols-4'} gap-8 p-12 bg-zinc-950 border-4 border-yellow-700 rounded-[50px] shadow-2xl`}>
                                {activeAnimals.map(a => (
                                    <div key={a.id} onClick={() => handleDeclare(a)} className="h-card" style={{margin: 0, width: '100px', height: '145px', borderColor: a.color}}>
                                        <img src={a.id === 'snake' ? SNAKE_IMAGES[0] : (a.id === 'mosquito' ? MOSQUITO_IMAGES[0] : (a.id === 'fly' ? FLY_IMAGES[0] : (a.id === 'rat' ? RAT_IMAGES[0] : (a.id === 'bat' ? BAT_IMAGES[0] : (a.id === 'cockroach' ? COCKROACH_IMAGES[0] : (a.id === 'spider' ? SPIDER_IMAGES[0] : (a.id === 'stinkbug' ? STINKBUG_IMAGES[0] : (a.id === 'toad' ? TOAD_IMAGES[0] : (a.id === 'scorpion' ? SCORPION_IMAGES[0] : a.img)))))))))} />
                                        <div className="card-name-overlay">{a.name}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="hand-area">
                        <div className="hand-tray">
                            {myHand.length > 0 ? myHand.map((c, i) => (
                                <div 
                                    key={c.inst} 
                                    className={`h-card ${selectedCard?.inst === c.inst ? 'selected' : ''}`} 
                                    style={{zIndex: i, borderColor: c.color}} 
                                    onClick={() => handlePickCard(c)}
                                    onMouseEnter={() => playSound(sfxHover)}
                                >
                                    <img src={getCardImg(c)} />
                                    <div className="card-name-overlay">{c.name}</div>
                                </div>
                            )) : (
                                <div className="text-zinc-500 font-bold animate-pulse text-xl" style={{fontFamily: "'Noto Sans KR', sans-serif"}}>카드를 분배받는 중...</div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<App />);
    </script>
</body>
</html>
