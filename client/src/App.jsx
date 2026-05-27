import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// 🚨🚨 ВСТАВ СВІЙ CLIENT ID З TWITCH DEVELOPER CONSOLE ТУТ 🚨🚨
const TWITCH_CLIENT_ID = 'fh66pb8rdh6mr32melibkiybfvhipr'; 
const REDIRECT_URI = window.location.origin;

const BACKEND_URL = 'https://alias-game-2oys.onrender.com';
const socket = io(BACKEND_URL);

const countdownSound = new Audio('/countdown.mp3');

const getPersistentId = () => {
  let id = localStorage.getItem('alias_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('alias_player_id', id);
  }
  return id;
};

const basePlayerId = getPersistentId();

function App() {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('alias_display_name') || '');
  const [twitchLogin, setTwitchLogin] = useState(() => localStorage.getItem('alias_twitch_login') || '');
  const [isTwitchAuth, setIsTwitchAuth] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [localTimer, setLocalTimer] = useState(0);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [showLoading, setShowLoading] = useState(false);
  
  const [appError, setAppError] = useState('');
  const errorTimerRef = useRef(null); // Зберігаємо ID таймера

  // 🔥 НОВИЙ КОД: Універсальна функція показу помилок
  const showError = (msg, time = 4000) => {
      setAppError(msg);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setAppError(''), time);
  };
  
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const [expandedTeams, setExpandedTeams] = useState({});

  const currentPlayerId = isTwitchAuth ? `twitch_${twitchLogin}` : basePlayerId;

 // 🔥 НОВИЙ КОД: Захист від мерехтіння екрану завантаження
  useEffect(() => {
    let timeout;
    if (!isConnected && showLoading) {
      timeout = setTimeout(() => setShowLoading(true), 1500);
    } else {
      // Якщо підключились швидко - ховаємо миттєво
      setShowLoading(false);
    }
    return () => clearTimeout(timeout);
  }, [isConnected]); 
  
useEffect(() => {
    // 🔥 НОВИЙ КОД: Шукаємо код кімнати в URL або в пам'яті
    const searchParams = new URLSearchParams(window.location.search);
    const urlRoom = searchParams.get('room');
    
    let pendingRoom = localStorage.getItem('alias_pending_room');

    if (urlRoom) {
        pendingRoom = urlRoom.toUpperCase();
        setRoomCode(pendingRoom);
        // Очищуємо адресний рядок від ?room=... щоб було красиво
        window.history.replaceState(null, '', window.location.pathname);
    } else if (pendingRoom) {
        setRoomCode(pendingRoom);
    }

    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      localStorage.setItem('alias_twitch_token', token);
      window.history.replaceState(null, '', window.location.pathname);
      
      fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Client-Id': TWITCH_CLIENT_ID
        }
      })
      .then(res => res.json())
      .then(data => {
            if (data.data && data.data.length > 0) {
               // 🔥 КРОК 2: Розділяємо логін і відображуване ім'я
               const twitchLoginName = data.data[0].login; 
               const twitchDisplayName = data.data[0].display_name;
               
               setTwitchLogin(twitchLoginName);
               localStorage.setItem('alias_twitch_login', twitchLoginName);
               localStorage.setItem('alias_twitch_name', twitchDisplayName); // Залишаємо для історії
               
               // Якщо кастомного ніка ще немає, ставимо ім'я з Твіча
               let finalPlayerName = localStorage.getItem('alias_display_name');
               if (!finalPlayerName) {
                   finalPlayerName = twitchDisplayName;
                   setPlayerName(finalPlayerName);
                   localStorage.setItem('alias_display_name', finalPlayerName);
               }
               
               if (window.opener) {
                   window.close();
               } else {
                   setIsTwitchAuth(true);
                   if (pendingRoom) {
                       socket.emit('joinRoom', { roomCode: pendingRoom, playerName: finalPlayerName, twitchLoginName: twitchLoginName, playerId: basePlayerId, isTwitchAuth: true, twitchToken: token });
                       localStorage.removeItem('alias_pending_room');
                   }
               }
            }
          }).catch(err => console.error("Помилка Twitch", err));
        } else {
           // Відновлюємо сесію зі збереженого логіна
           const savedTwitchLogin = localStorage.getItem('alias_twitch_login');
           if (savedTwitchLogin) {
               setIsTwitchAuth(true);
               if (pendingRoom) {
                   const currentName = localStorage.getItem('alias_display_name') || savedTwitchLogin;
                   socket.emit('joinRoom', { roomCode: pendingRoom, playerName: currentName, twitchLoginName: savedTwitchLogin, playerId: basePlayerId, isTwitchAuth: true, twitchToken: localStorage.getItem('alias_twitch_token') });
                   localStorage.removeItem('alias_pending_room');
               }
           }
        }

    const handleStorageChange = (e) => {
        if (e.key === 'alias_twitch_name') {
            if (e.newValue) {
                setPlayerName(e.newValue);
                setIsTwitchAuth(true);
            } else {
                setPlayerName('');
                setIsTwitchAuth(false);
            }
        }
    };
    window.addEventListener('storage', handleStorageChange);

    socket.on('roomCreated', setRoom);
    socket.on('roomUpdated', (data) => { 
      setRoom(data); 
      setLocalTimer(data.gameState.timeLeft); 
    });
    socket.on('timerUpdate', setLocalTimer);
    
    socket.on('error', (msg) => showError(msg));

    socket.on('disconnect', () => {
        setIsConnected(false);
        console.log('❌ Зв\'язок із сервером втрачено');
    });

    socket.on('kicked', () => {
        setRoom(null);
        setRoomCode('');
        showError('Вас вигнали з кімнати!', 5000);
    });

    socket.on('kicked_duplicate', () => {
        setRoom(null);
        setRoomCode('');
        showError('Виконано вхід з іншого пристрою! Вас відключено.', 7000);
    });

    const pingInterval = setInterval(() => {
      fetch(`${BACKEND_URL}/ping`).catch(() => {});
    }, 10 * 60 * 1000); 

    return () => {
      socket.removeAllListeners();
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(pingInterval);
    };
  }, []);

// 🔥 НОВИЙ КОД: Захист від згортання (Sleep/Wake) на мобільних телефонах
  useEffect(() => {
    const handleWakeUp = () => {
      setIsConnected(true);
      // Якщо у нас вже є код кімнати та ім'я - автоматично "стукаємо" на сервер
      if (roomCode && playerName) {
        console.log('🔄 Відновлення сесії після сну/згортання...');
        const token = localStorage.getItem('alias_twitch_token');
        socket.emit('joinRoom', { 
          roomCode: roomCode.toUpperCase(), 
          playerName: playerName, 
          twitchLoginName: twitchLogin, 
          playerId: basePlayerId, 
          isTwitchAuth: isTwitchAuth, 
          twitchToken: token 
        });
      }
    };

    const handleVisibilityChange = () => {
      // Якщо вкладку розгорнули після згортання
      if (document.visibilityState === 'visible') {
        if (!socket.connected) {
          socket.connect(); // Примусово будимо сокет, якщо він відвалився
        } else {
          handleWakeUp(); // Якщо живий, але була пауза - синхронізуємо стан із сервером
        }
      }
    };

    // Вішаємо слухачі
    socket.on('connect', handleWakeUp);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      socket.off('connect', handleWakeUp);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [roomCode, playerName, twitchLogin, isTwitchAuth, basePlayerId]);
  
// ⏱ НОВИЙ КОД: звук відліку тільки для активних гравців + захист від фонових вкладок
  useEffect(() => {
    // Спрацьовує тільки коли статус змінюється на countdown і таймер на 3
    if (room?.gameState?.status === 'countdown' && localTimer === 3) {
      
      const activeTeam = room.teams.find(t => t.id === room.gameState.currentTeamId);
      const teamPlayers = room.players.filter(p => p.teamId === activeTeam?.id);
      const activeExplainer = room.players.find(p => p.id === room.gameState.currentExplainerId);
      const expIdx = teamPlayers.findIndex(p => p.id === activeExplainer?.id);
      const activeGuesser = teamPlayers[(expIdx + 1) % (teamPlayers.length || 1)];

      const amIActive = currentPlayerId === activeExplainer?.playerId || currentPlayerId === activeGuesser?.playerId;

      if (amIActive) {
        // Ставимо мікро-паузу на 100мс
        const timer = setTimeout(() => {
          countdownSound.volume = 0.6; // Зберігаємо твоє налаштування гучності
          countdownSound.currentTime = 0;
          countdownSound.play().catch(err => console.log('Автоплей заблоковано браузером:', err));
        }, 100);

        // Якщо це стара подія з фонової вкладки, скасовуємо звук до його початку
        return () => clearTimeout(timer);
      }
    }
  }, [room?.gameState?.status, localTimer, currentPlayerId, room]);


  const handleTwitchLogin = () => {
    // 🔥 НОВИЙ КОД: Зберігаємо код кімнати перед редиректом
    if (roomCode) {
        localStorage.setItem('alias_pending_room', roomCode);
    }
    
    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token`;
    const width = 500;
    const height = 650;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.location.href = url;
  };
const handleTwitchLogout = () => {
    localStorage.removeItem('alias_twitch_name');
    localStorage.removeItem('alias_twitch_token');
    localStorage.removeItem('alias_twitch_login');
    setTwitchLogin('');
    setIsTwitchAuth(false);
  };

  const handleCreateRoom = () => {
    const token = localStorage.getItem('alias_twitch_token'); 
    socket.emit('createRoom', { playerName, twitchLoginName: twitchLogin, playerId: basePlayerId, isTwitchAuth, twitchToken: token });
  };

  const handleJoinRoom = () => {
    if (roomCode.length !== 4) return;
    const token = localStorage.getItem('alias_twitch_token'); 
    socket.emit('joinRoom', { roomCode: roomCode.toUpperCase(), playerName, twitchLoginName: twitchLogin, playerId: basePlayerId, isTwitchAuth, twitchToken: token });
  };
  const updateSettings = (newSettings) => socket.emit('updateSettings', { roomCode: room.id, settings: { ...room.settings, ...newSettings } });
  
  const handleCreateTeam = () => { if (newTeamName) { socket.emit('createTeam', { roomCode: room.id, teamName: newTeamName }); setNewTeamName(''); } };
  const handleDeleteTeam = (teamId) => socket.emit('deleteTeam', { roomCode: room.id, teamId });
  const handleAdjustScore = (teamId, amount) => socket.emit('adjustScore', { roomCode: room.id, teamId, amount });
  const handleShuffleTeams = () => socket.emit('shuffleTeams', { roomCode: room.id });
  const handleResetGame = () => { if(window.confirm('Скинути всі рахунки, кола та історію до нуля?')) socket.emit('resetGame', { roomCode: room.id }); };
  const handleKickPlayer = (targetId) => { if(window.confirm('Точно вигнати гравця? Він не зможе повернутися.')) socket.emit('kickPlayer', { roomCode: room.id, targetPlayerId: targetId }); };
  const handleTransferHost = (targetId) => { 
    if(window.confirm('Точно передати права хоста цьому гравцеві? Ти втратиш можливість керувати налаштуваннями кімнати.')) {
        socket.emit('transferHost', { roomCode: room.id, newHostId: targetId }); 
    }
  };

const handleCopyCode = () => {
    if (room && room.id) {
      // 🔥 НОВИЙ КОД: Формуємо повне посилання
      const inviteLink = `${window.location.origin}/?room=${room.id}`;
      navigator.clipboard.writeText(inviteLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

// 🔥 НОВИЙ КОД: Універсальна перевірка перед стартом гри
  const validateBeforeStart = () => {
      // 1. Перевірка словника
      if (room.settings.dictType === 'custom') {
          const wordCount = room.settings.customWords?.length || 0;
          if (wordCount < 50) {
              setAppError(`Для свого словника потрібно мінімум 50 слів! (Зараз: ${wordCount})`);
              setTimeout(() => setAppError(''), 4000);
              return false; // Забороняємо старт
          }
      }

      // 2. Перевірка онлайну
      if (room.players.some(p => p.teamId !== null && !p.online)) {
          setAppError('Один з гравців у командах не в мережі! Дочекайтесь його або замініть.');
          setTimeout(() => setAppError(''), 4000);
          return false; // Забороняємо старт
      }

      return true; // Все супер, можна грати
  };

  const handleStartGameLobby = () => {
    const maxTurns = room.settings.laps === 'infinity' ? Infinity : parseInt(room.settings.laps) * (room.teams.length * 2 || 1);
    
    // Перевірка на завершення гри
    if (maxTurns !== Infinity && room.gameState.turnsTaken >= maxTurns) {
        if (window.confirm('Гру вже завершено! Бажаєте скинути рахунки і почати нове коло?')) {
            socket.emit('resetGame', { roomCode: room.id });
            setTimeout(() => {
                // Використовуємо нашу нову функцію перевірки
                if (validateBeforeStart()) {
                    socket.emit('startTurn', { roomCode: room.id });
                }
            }, 500);
        }
        return;
    }

    // Звичайний старт з перевіркою
    if (validateBeforeStart()) {
        socket.emit('startTurn', { roomCode: room.id });
    }
  };

  const handleStartTurnFromScoreboard = () => {
      // Тут теж просто викликаємо одну функцію
      if (validateBeforeStart()) {
          socket.emit('startTurn', { roomCode: room.id });
      }
  };

const ErrorToast = () => appError ? (
    <div style={{
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: 'var(--accent-red)', color: 'white', padding: '15px 30px',
        borderRadius: '10px', zIndex: 9999, fontWeight: 'bold', 
        boxShadow: '0 4px 15px rgba(255, 71, 87, 0.4)', textAlign: 'center'
    }}>
      {appError}
    </div>
  ) : null;

  // 🔥 НОВИЙ КОД: Екран завантаження, якщо сервер ще спить
  if (!isConnected && showLoading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', 
        justifyContent: 'center', height: '100vh', textAlign: 'center', padding: '20px'
      }}>
        <h2 style={{ color: 'var(--accent-green)' }}>🚀 Сервер прокидається...</h2>
        <p className="muted" style={{ maxWidth: '400px', margin: '10px auto', lineHeight: '1.5' }}>
          Оскільки ми використовуємо безкоштовний хостинг, серверу треба близько хвилини на "холодний старт". 
          <br/><br/>
          Будь ласка, зачекай і не закривай сторінку!
        </p>
        <div style={{
           marginTop: '30px', width: '50px', height: '50px', 
           border: '4px solid rgba(255,255,255,0.1)', 
           borderTop: '4px solid var(--accent-green)', 
           borderRadius: '50%', animation: 'spin 1s linear infinite'
        }}></div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Твій старий код лобі
  if (!room) {
    return (
      <>
        <ErrorToast />
        <div className="app-wrapper">
          <div className="container">
            <h1 className="logo-title">ЕЛІАС</h1>
            
            {isTwitchAuth ? (
              <div style={{ textAlign: 'center', backgroundColor: '#3d4554', padding: '15px', borderRadius: '12px' }}>
                <p style={{ marginBottom: '10px' }}>Увійшли через Twitch як: <strong style={{ color: '#a970ff' }}>{playerName}</strong></p>
                <button className="ghost-btn" style={{ padding: '8px 15px', fontSize: '0.9rem' }} onClick={handleTwitchLogout}>Вийти з Twitch</button>
              </div>
            ) : (
              <>
<input 
  type="text" 
  placeholder="Нікнейм" 
  value={playerName} 
  maxLength={20}
  onChange={e => {
    setPlayerName(e.target.value);
    localStorage.setItem('alias_display_name', e.target.value);
  }} 
/>
                <button style={{ backgroundColor: '#a970ff', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={handleTwitchLogin}>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
  </svg>
  Увійти через Twitch
</button>
              </>
            )}

            <div className="divider">Створити гру</div>
            <button className="primary-btn" onClick={handleCreateRoom} disabled={!playerName}>Створити кімнату</button>
            
            <div className="divider">АБО</div>
            <input type="text" placeholder="Введіть код" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button className="secondary-btn" onClick={handleJoinRoom} disabled={!playerName || !roomCode}>Увійти в кімнату</button>
          </div>
          {/* 🔥 НОВИЙ КОД: SEO-блок, опис гри та правила */}
          <div className="container" style={{ marginTop: '20px', padding: '20px', textAlign: 'left', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '10px', color: 'var(--accent-yellow)' }}>Про гру Еліас (Alias) Онлайн</h2>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.5', color: 'var(--text-muted)', marginBottom: '15px' }}>
              <strong>Еліас</strong> — це популярна командна настільна гра для компанії. Головне завдання — пояснити своєму партнеру по команді якомога більше слів за обмежений час. Використовуйте синоніми, асоціації та натяки, щоб перемогти. Грайте онлайн з друзями або на стрімі абсолютно безкоштовно та без реєстрації!
            </p>
            
            <h3 style={{ fontSize: '1rem', marginBottom: '8px', color: 'white' }}>📜 Короткі правила:</h3>
            <ul style={{ fontSize: '0.9rem', color: 'var(--text-muted)', paddingLeft: '20px', marginBottom: '15px', lineHeight: '1.4' }}>
              <li>Граємо командами по 2 людини.</li>
              <li>Пояснюйте слова українською без використання спільнокореневих слів чи перекладів.</li>
              <li>Вгадали слово: <strong>+1 бал</strong>. Не знаєте і пропустили (скіп): <strong>-1 бал</strong>.</li>
            </ul>
            
            <div style={{ textAlign: 'center', marginTop: '15px', paddingTop: '15px', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
              <a 
                href="https://github.com/sancho1x/alias-game" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#a970ff', textDecoration: 'none', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '8px', transition: 'opacity 0.2s' }}
                onMouseOver={(e) => e.target.style.opacity = '0.8'}
                onMouseOut={(e) => e.target.style.opacity = '1'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                📖 Читати повний посібник та механіки
              </a>
            </div>
          </div>
        </div>
      </>
    );
  }
  
  const isHost = room.hostId === currentPlayerId;
  const currentTeam = room.teams[room.gameState.currentTeamIndex];
  const myPlayerInfo = room.players.find(p => p.playerId === currentPlayerId);

const renderPlayersList = (compact = false) => (
    <div className="players-list">
      <h3>Гравці {compact && 'у кімнаті'}</h3>
      <ul style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {room.players.map(p => (
          <li key={p.playerId} style={{ opacity: p.online ? 1 : 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ color: p.online ? 'inherit' : 'var(--text-muted)' }}>
{p.isTwitch && (
  <span style={{ marginRight: '6px', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }} title="Авторизований через Twitch">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#9146FF">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
    </svg>
  </span>
)}
{p.name} 
{p.playerId === room.hostId && <span className="host-crown" title="Хост">👑</span>} 
{!p.online && " (не в мережі)"}

{/* 🔥 НОВИЙ КОД: Справжній нікнейм тільки для хоста */}
{isHost && !compact && p.playerId !== room.hostId && (
  <span className="muted" style={{ fontSize: '0.85rem', marginLeft: '8px' }}>
    ({p.isTwitch ? `Twitch: ${p.playerId.replace('twitch_', '')}` : 'Без Twitch'})
  </span>
)}
              </span>
              <span className="muted" style={{ marginLeft: '10px' }}>
                {room.teams.find(t => t.id === p.teamId) ? `(${room.teams.find(t => t.id === p.teamId).name})` : ''}
              </span>
            </div>
            
{/* 🔥 НОВИЙ КОД: Блок з кнопками передачі хоста, скидання ніка та кіку */}
            {isHost && p.playerId !== currentPlayerId && !compact && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <button 
                    onClick={() => socket.emit('resetPlayerName', { roomCode: room.id, targetPlayerId: p.playerId })} 
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }}
                    title="Скинути нікнейм до дефолтного"
                  >
                    🔄
                  </button>
                  <button 
                    onClick={() => handleTransferHost(p.playerId)} 
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }}
                    title="Передати права хоста"
                  >
                    👑
                  </button>
                  <button 
                    onClick={() => handleKickPlayer(p.playerId)} 
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }}
                    title="Вигнати гравця"
                  >
                    💀
                  </button>
                </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  const renderTeamHistory = (teamId) => {
    const history = room.gameState.fullHistory?.filter(h => h.teamId === teamId) || [];
    if (history.length === 0) return <div className="muted" style={{ padding: '10px 0', fontSize: '0.9rem' }}>Історія поки порожня</div>;

    const laps = {};
    history.forEach((h) => {
        if (!laps[h.lap]) laps[h.lap] = [];
        laps[h.lap].push({ ...h, roundNum: laps[h.lap].length + 1 });
    });

    return (
        <div style={{ marginTop: '15px', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
            {Object.keys(laps).map(lapNum => (
                <div key={lapNum} style={{ marginBottom: '20px' }}>
                    <h4 style={{ color: 'var(--accent-yellow)', marginBottom: '10px', fontSize: '1.1rem' }}>Коло {lapNum}</h4>
                    {laps[lapNum].map((turn) => (
                        <div key={turn.roundNum} style={{ marginBottom: '15px', backgroundColor: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                            <p style={{ fontSize: '0.95rem', marginBottom: '8px', color: 'var(--text-muted)' }}>
                                Раунд {turn.roundNum} <span style={{color: 'white'}}>(Пояснював: <strong>{turn.explainerName}</strong>, Відгадував: <strong>{turn.guesserName}</strong>):</span>
                            </p>
                            <div className="word-history" style={{ justifyContent: 'flex-start', margin: '0', maxWidth: '100%', gap: '6px' }}>
                                {turn.words.map((w, i) => (
                                    <span key={i} className={`history-pill ${w.status}`} style={{ padding: '5px 12px', fontSize: '0.85rem' }}>
                                        {w.word}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
  };

  if (room.gameState.status === 'countdown') {
    const activeTeam = room.teams.find(t => t.id === room.gameState.currentTeamId);
    const teamPlayers = room.players.filter(p => p.teamId === activeTeam?.id);
    const activeExplainer = room.players.find(p => p.id === room.gameState.currentExplainerId);
    const expIdx = teamPlayers.findIndex(p => p.id === activeExplainer?.id);
    const activeGuesser = teamPlayers[(expIdx + 1) % (teamPlayers.length || 1)];

    return (
      <>
        <ErrorToast />
        <div className="app-wrapper game-mode" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <h2 style={{ color: 'white', marginBottom: '15px', fontSize: '2.5rem' }}>Готуйтесь!</h2>
          
          {activeTeam && (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '20px 40px', borderRadius: '15px', textAlign: 'center', marginBottom: '20px', border: '1px dashed var(--accent-yellow)' }}>
                  <h3 style={{ color: 'var(--accent-green)', marginBottom: '10px', fontSize: '1.5rem' }}>{activeTeam.name}</h3>
                  <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6' }}>
                      Пояснює: <strong style={{ color: 'white' }}>{activeExplainer?.name || '...'}</strong><br/>
                      Відгадує: <strong style={{ color: 'white' }}>{activeGuesser?.name || '...'}</strong>
                  </p>
              </div>
          )}

          <h1 style={{ fontSize: '10rem', color: 'var(--accent-yellow)', margin: '0', textShadow: '0 0 20px rgba(255, 195, 18, 0.4)' }}>{localTimer}</h1>
        </div>
      </>
    );
  }

  if (room.gameState.status === 'paused') {
    const canResume = isHost || room.gameState.currentExplainerId === socket.id;
    return (
      <>
        <ErrorToast />
        <div className="app-wrapper game-mode" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <h1 style={{ fontSize: '4rem', color: 'var(--accent-yellow)', marginBottom: '30px' }}>ПАУЗА</h1>
          {room.gameState.autoPausedBySystem && (
             <p style={{ color: 'var(--accent-red)', marginBottom: '20px', textAlign: 'center' }}>Один з активних гравців втратив з'єднання!</p>
          )}
          {canResume ? (
            <div style={{ display: 'flex', gap: '15px', flexDirection: 'column' }}>
              <button className="btn-correct" style={{ padding: '20px 40px', fontSize: '1.5rem' }} onClick={() => socket.emit('resumeGame', { roomCode: room.id, action: 'resume' })}>
                Продовжити гру
              </button>
              <button className="ghost-btn" style={{ padding: '15px' }} onClick={() => socket.emit('returnToLobby', { roomCode: room.id })}>
                В лобі (Таймер зупиниться)
              </button>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: '1.2rem' }}>Очікуємо, поки ведучий зніме гру з паузи...</p>
          )}
        </div>
      </>
    );
  }

  if (room.gameState.status === 'playing' || room.gameState.status === 'last_word') {
    const isExplainer = room.gameState.currentExplainerId === socket.id;
    const isMyTeamPlaying = room.gameState.currentTeamId === myPlayerInfo?.teamId;
    const isLast = room.gameState.status === 'last_word';
    
    return (
      <>
        <ErrorToast />
        <div className="app-wrapper game-mode" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="app-wrapper game-mode" style={{ height: '98dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
          <div className="game-header">
            <div className="team-info-top" style={{ display: 'flex', gap: '15px', alignItems: 'center', fontSize: '1.2rem' }}>
              <span className="team-name" style={{ 
                fontWeight: 'bold', 
                maxWidth: '120px', 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis', 
                display: 'inline-block', 
                verticalAlign: 'bottom' 
              }}>
                {currentTeam?.name}
              </span>
              <span className="team-live-score" style={{ color: 'var(--text-muted)' }}>
                Рахунок: <strong style={{ color: 'var(--accent-green)' }}>{currentTeam?.score}</strong>
              </span>
            </div>
            <div className="team-info-top" style={{ display: 'flex', gap: '15px', alignItems: 'center', fontSize: '1.2rem' }}>
              <span className="team-name" style={{ fontWeight: 'bold' }}>{currentTeam?.name}</span>
              <span className="team-live-score" style={{ color: 'var(--text-muted)' }}>
                Рахунок: <strong style={{ color: 'var(--accent-green)' }}>{currentTeam?.score}</strong>
              </span>
            </div>
            
<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
  {(isHost || isExplainer) && (
    <>
      <button className="secondary-btn" style={{ padding: '8px 12px', fontSize: '1rem' }} onClick={() => socket.emit('pauseGame', { roomCode: room.id })}>
        ⏸
      </button>
      <button className="ghost-btn" style={{ padding: '8px 12px', fontSize: '1rem' }} onClick={() => socket.emit('returnToLobby', { roomCode: room.id })}>
        🏠
      </button>
    </>
  )}
  <div className={`timer-display ${isLast ? 'timer-warning' : (localTimer < 10 ? 'timer-danger' : '')}`} style={{ marginLeft: '10px' }}>
    {isLast ? 'ОСТАННЄ' : localTimer}
  </div>
</div>
          </div>
          
          <div className="game-board" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingBottom: '20px', overflowY: 'auto' }}>
            {isExplainer ? (
              <>
                <div className="word-container" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
  <h1 className="main-word" style={{ margin: 0, wordBreak: 'break-word', textAlign: 'center' }}>
    {room.gameState.currentWord}
  </h1>
</div>
                <div className="action-buttons">
                  {!isLast ? (
                    <button className="btn-skip" onClick={() => socket.emit('nextWord', { roomCode: room.id, isCorrect: false })}>Скіп (-1)</button>
                  ) : (
                    <button className="secondary-btn" onClick={() => socket.emit('lastWordResult', { roomCode: room.id, isCorrect: false })}>Не вгадали (0)</button>
                  )}
                  <button className="btn-correct" onClick={() => socket.emit(isLast ? 'lastWordResult' : 'nextWord', { roomCode: room.id, isCorrect: true })}>Вгадали (+1)</button>
                </div>
              </>
             ) : (
<div className="guesser-view" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
              <h1 style={{ color: isLast ? '#ffc312' : (isMyTeamPlaying ? '#ff4757' : '#a4b0be'), textAlign: 'center', marginBottom: '20px' }}>
                {isMyTeamPlaying ? 'Вгадуйте!' : `Грає команда: ${currentTeam?.name}`}
              </h1>
              <div className="word-history" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
                {room.gameState.roundHistory.map((item, idx) => (
                  <span key={idx} className={`history-pill ${item.status}`}>{item.word}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

  if (room.gameState.status === 'turn_ended' || room.gameState.status === 'game_over') {
    const isGameOver = room.gameState.status === 'game_over';
    
    const nextTeam = room.teams[room.gameState.currentTeamIndex];
    const nextTeamPlayers = room.players.filter(p => p.teamId === nextTeam?.id);
    const nextExplainerIdx = (room.gameState.explainerIndices[nextTeam?.id] || 0) % (nextTeamPlayers.length || 1);
    const nextExplainer = nextTeamPlayers[nextExplainerIdx];
    const nextGuesser = nextTeamPlayers[(nextExplainerIdx + 1) % (nextTeamPlayers.length || 1)];
    
    const canEditWords = isHost || socket.id === room.gameState.lastExplainerId;

    const turnsPerLap = (room.teams.length || 1) * 2;
    const currentLapNum = Math.ceil(room.gameState.turnsTaken / turnsPerLap) || 1;
    const currentRoundNum = room.gameState.turnsTaken % turnsPerLap || turnsPerLap;
    const totalLapsDisplay = room.settings.laps === 'infinity' ? '∞' : room.settings.laps;

    return (
      <>
        <ErrorToast />
        <div className="app-wrapper">
          <div className="container end-turn-container">
            {isGameOver ? (
              <h1 className="text-success" style={{ textAlign: 'center', marginBottom: '5px', fontSize: '2.5rem' }}>🏆 ГРА ЗАВЕРШЕНА!</h1>
            ) : (
              <h1 className="text-danger" style={{ textAlign: 'center', marginBottom: '5px' }}>Хід завершено! 🏁</h1>
            )}
            
            <p style={{ textAlign: 'center', color: 'var(--accent-yellow)', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '15px' }}>
                Раунд {currentRoundNum} з {turnsPerLap}, Коло {currentLapNum} / {totalLapsDisplay}
            </p>

            {canEditWords && !isGameOver && (
              <p className="muted" style={{ textAlign: 'center', marginBottom: '15px' }}>Натискай на слова, щоб змінити їх статус (Зелений: +1, Сірий: 0, Червоний: -1)</p>
            )}

            <div className="word-history" style={{ marginBottom: '30px' }}>
              {room.gameState.roundHistory.map((item, idx) => (
                <span 
                  key={idx} 
                  className={`history-pill ${item.status} ${canEditWords ? 'clickable' : ''}`}
                  onClick={() => canEditWords && socket.emit('toggleWord', { roomCode: room.id, wordIndex: idx })}
                >
                  {item.word}
                </span>
              ))}
            </div>

            <div className="score-board">
              <h3 style={{ marginBottom: '15px' }}>Рахунок:</h3>
              {[...room.teams].sort((a, b) => b.score - a.score).map(t => (
                <div key={t.id} className="score-row">
                  <span>{t.name}</span><strong className="text-success">{t.score}</strong>
                </div>
              ))}
            </div>

            {!isGameOver && (
              <div className="next-team-announcement" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '15px', borderRadius: '10px' }}>
                <h3>Наступні: <span className="text-success">{nextTeam?.name}</span></h3>
                <p className="muted" style={{ marginTop: '10px', fontSize: '1.1rem', lineHeight: '1.5' }}>
                  Пояснює: <strong style={{ color: 'white' }}>{nextExplainer?.name || '...'}</strong> <br/>
                  Відгадує: <strong style={{ color: 'white' }}>{nextGuesser?.name || '...'}</strong>
                </p>
              </div>
            )}
            
            {isHost ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                {!isGameOver && <button className="mega-btn" onClick={handleStartTurnFromScoreboard}>▶ ПОЧАТИ ХІД</button>}
                <button className="ghost-btn" onClick={() => socket.emit('endGame', { roomCode: room.id })}>В лобі (Новий раунд)</button>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: '20px', textAlign: 'center' }}>Очікуємо рішення хоста...</p>
            )}

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />
            {renderPlayersList(true)}
          </div>
        </div>
      </>
    );
  }

  // --- ЛОБІ ---
  const maxTurns = room.settings.laps === 'infinity' ? Infinity : parseInt(room.settings.laps) * (room.teams.length * 2 || 1);
  let currentLap = Math.floor(room.gameState.turnsTaken / (room.teams.length * 2 || 1)) + 1;
  if (maxTurns !== Infinity && room.gameState.turnsTaken >= maxTurns) currentLap = room.settings.laps; 
  
  const totalLapsDisplay = room.settings.laps === 'infinity' ? '∞' : room.settings.laps;
  const isGamePausedInLobby = room.gameState.pausedState === 'active_turn';

  const lobbyNextTeam = room.teams[room.gameState.currentTeamIndex] || room.teams[0];
  let lobbyNextExplainer = null;
  let lobbyNextGuesser = null;
  
  if (lobbyNextTeam) {
      const teamPlayers = room.players.filter(p => p.teamId === lobbyNextTeam.id);
      const expIdx = (room.gameState.explainerIndices[lobbyNextTeam.id] || 0) % (teamPlayers.length || 1);
      lobbyNextExplainer = teamPlayers[expIdx];
      lobbyNextGuesser = teamPlayers[(expIdx + 1) % (teamPlayers.length || 1)];
  }

  return (
    <>
      <ErrorToast />
      <div className="app-wrapper">
        <div className="container">
          
          <div className="room-code-display" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Код:</span>
                  <strong 
                      onClick={() => setIsCodeVisible(!isCodeVisible)}
                      title="Натисніть, щоб показати/сховати"
                      style={{ 
                          cursor: 'pointer', 
                          letterSpacing: isCodeVisible ? 'normal' : '3px',
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          minWidth: '60px',
                          textAlign: 'center',
                          userSelect: 'none'
                      }}
                  >
                      {isCodeVisible ? room.id : '****'}
                  </strong>
                  <button 
                      onClick={handleCopyCode}
                      title="Скопіювати код"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0', display: 'flex', alignItems: 'center' }}
                  >
                      {isCopied ? '✅' : '📋'}
                  </button>
              </div>
              <span style={{ color: 'var(--accent-yellow)' }}>Коло {currentLap} / {totalLapsDisplay}</span>
          </div>

          {lobbyNextTeam && (
              <div className="next-team-announcement" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '15px', borderRadius: '10px', marginTop: '20px', marginBottom: '10px', textAlign: 'center', border: '1px dashed var(--accent-yellow)' }}>
                <h3 style={{ fontSize: '1.2rem', margin: '0 0 8px 0' }}>Зараз стартують: <span className="text-success">{lobbyNextTeam.name}</span></h3>
                <p className="muted" style={{ margin: 0, fontSize: '1rem', lineHeight: '1.5' }}>
                  Пояснює: <strong style={{ color: 'white' }}>{lobbyNextExplainer?.name || '...'}</strong> <br/>
                  Відгадує: <strong style={{ color: 'white' }}>{lobbyNextGuesser?.name || '...'}</strong>
                </p>
              </div>
          )}
          
          {isHost && room.teams.length > 0 && (
            isGamePausedInLobby ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                <button className="mega-btn pulse" style={{ backgroundColor: 'var(--accent-green)' }} onClick={() => socket.emit('resumeGame', { roomCode: room.id, action: 'resume' })}>
                  ▶ ПРОДОВЖИТИ ПЕРЕРВАНИЙ ХІД
                </button>
                <button className="ghost-btn" style={{ borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)' }} onClick={() => {
                  if(window.confirm('Ви впевнені? Всі бали, зароблені за цей хід, будуть скасовані, і гравець почне свої секунди заново з новими словами.')) {
                    socket.emit('resumeGame', { roomCode: room.id, action: 'restart_turn' });
                  }
                }}>
                  🔄 ПОЧАТИ ХІД З НУЛЯ (З НОВИМИ НАЛАШТУВАННЯМИ)
                </button>
              </div>
            ) : (
              <button className="mega-btn pulse" onClick={handleStartGameLobby}>
                ▶ ПОЧАТИ ГРУ
              </button>
            )
          )}
<div className="settings-panel">
            <h3>Налаштування {isHost ? '⚙️' : '(Тільки хост)'}</h3>
            {isHost ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', backgroundColor: 'rgba(169, 112, 255, 0.1)', borderRadius: '8px', border: '1px solid #a970ff' }}>
                  <input 
                    type="checkbox" 
                    checked={room.settings.requireTwitchAuth} 
                    onChange={e => updateSettings({ requireTwitchAuth: e.target.checked })} 
                    style={{ width: 'auto' }}
                  />
                  Обов'язковий вхід через Twitch
                </label>

                {/* ПРИБРАНО disabled={isGamePausedInLobby} ДЛЯ ВСІХ ПОЛІВ НИЖЧЕ */}
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>Час раунду (в секундах): 
<input 
  type="number"
  min="10"
  value={room.settings.timer} 
  onChange={e => updateSettings({ timer: e.target.value === '' ? '' : Number(e.target.value) })} 
  onBlur={e => {
      const val = Number(e.target.value);
      if (!val || val < 10) updateSettings({ timer: 60 });
  }}
  style={{ marginTop: '8px', width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' }} 
/>
                </label>
                
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>Словник: 
<select value={room.settings.dictType} onChange={e => updateSettings({ dictType: e.target.value })} style={{ marginTop: '8px', width: '100%' }}>
            {/* Базові */}
            <option value="easy">Легкий </option>
            <option value="medium">Середній </option>
            <option value="hard">Важкий </option>
            
            {/* Альтернативні */}
            <option value="easy_alt">Легкий (Альтернативний)</option>
            <option value="medium_alt">Середній (Альтернативний)</option>
            <option value="hard_alt">Важкий (Альтернативний)</option>
            
            {/* Тематичні */}
            <option value="movies">Кіно та серіали</option>
            <option value="gamer_experimental_alt">Геймерський(Альтернативний) </option>
            <option value="gamer_experimental">Геймерський </option>
            <option value="science">Наука</option>
            <option value="marvel_dc">Marvel & DC</option>
            <option value="ua_culture">Український колорит</option>
            <option value="IT">IT (Айтішка)</option>
            <option value="harry_potter">Гаррі Поттер</option>
            
            {/* Кастомний */}
            <option value="custom">Свій словник</option>
          </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>Кількість кіл (0 = Безкінечно): 
                  <input 
                    type="number"
                    min="0"
                    value={room.settings.laps === 'infinity' ? 0 : room.settings.laps} 
                    onChange={e => {
                        const val = Number(e.target.value);
                        updateSettings({ laps: val <= 0 ? 'infinity' : val });
                    }} 
                    style={{ marginTop: '8px', width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' }} 
                  />
                </label>

{room.settings.dictType === 'custom' && (
                  <textarea 
                    className="settings-input"
                    placeholder="Введіть слова чи фрази. Кожна фраза з нового рядка або через крапку з комою (;)..." 
                    defaultValue={room.settings.customWords?.join('\n')} 
                    onBlur={e => {
                        const parsedWords = e.target.value
                            .split(/[\n\r;]+/) // Розбиваємо по переносу рядка або ;
                            .map(w => w.trim()) // Відрізаємо зайві пробіли по краях
                            .filter(w => w);    // Видаляємо порожні рядки
                        updateSettings({ customWords: parsedWords });
                    }}
                    style={{ minHeight: '150px', resize: 'vertical' }}
                  />
                )}
              </div>
            ) : (
              <div className="read-only-settings" style={{ marginTop: '15px' }}>
                <p>Обов'язковий Twitch: <strong style={{ color: room.settings.requireTwitchAuth ? 'var(--accent-green)' : 'inherit' }}>{room.settings.requireTwitchAuth ? 'Так' : 'Ні'}</strong></p>
                <p>Час: <strong>{room.settings.timer} сек</strong></p>
                <p>Словник: <strong>{room.settings.dictType}</strong></p>
                <p>Кіл: <strong>{room.settings.laps === 'infinity' ? 'Безкінечно' : room.settings.laps}</strong></p>
              </div>
            )}
          </div>

          <div className="teams-list">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{room.teams.some(t => t.score !== 0) ? '🏆 Турнірна таблиця / Історія' : 'Команди'}</h3>
              {isHost && room.players.filter(p => p.teamId).length > 0 && !isGamePausedInLobby && (
                  <button className="secondary-btn" style={{ padding: '8px 15px', fontSize: '0.9rem' }} onClick={handleShuffleTeams}>🔀 Мікс</button>
              )}
            </div>
            
            <div className="input-group inline" style={{ marginBottom: '15px', marginTop: '15px' }}>
              <input type="text" placeholder="Назва команди" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} disabled={isGamePausedInLobby} />
              <button onClick={handleCreateTeam} disabled={isGamePausedInLobby}>+</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[...room.teams].sort((a, b) => b.score - a.score).map(t => {
                const teamPlayers = room.players.filter(p => p.teamId === t.id);
                const isFull = teamPlayers.length >= 2;
                const amIInThisTeam = myPlayerInfo?.teamId === t.id;
                
                const isExpanded = expandedTeams[t.id];

                return (
                  <div key={t.id} className="team-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '15px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
                          <span 
                            style={{ fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none' }}
                            onClick={() => setExpandedTeams(prev => ({...prev, [t.id]: !prev[t.id]}))}
                            title="Натисни, щоб переглянути історію раундів"
                          >
<span style={{ fontSize: '1.2rem', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
{t.name} 

{/* 🔥 НОВИЙ КОД: Кнопка перейменування команди */}
{isHost && !isGamePausedInLobby && (
  <span 
    style={{ fontSize: '0.9rem', marginLeft: '5px', opacity: '0.7' }} 
    title="Перейменувати команду"
    onClick={(e) => {
      e.stopPropagation(); // Щоб не відкривалась історія при кліку на олівець
      const newName = window.prompt('Введіть нову назву команди:', t.name);
      if (newName && newName.trim() && newName.trim() !== t.name) {
         socket.emit('renameTeam', { roomCode: room.id, teamId: t.id, newName: newName.trim() });
      }
    }}
  >
    ✏️
  </span>
)}

<span className="muted" style={{ fontWeight: 'normal', marginLeft: '8px' }}>({teamPlayers.length}/2)</span>
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '25px' }}>
                            {isHost && <button className="score-adjust" onClick={() => handleAdjustScore(t.id, -1)}>-</button>}
                            <strong className="score-pill">{t.score} балів</strong>
                            {isHost && <button className="score-adjust" onClick={() => handleAdjustScore(t.id, 1)}>+</button>}
                          </div>
                        </div>

                        {/* 🔥 НОВИЙ КОД: Кнопка "Вийти", якщо гравець у цій команді */}
<div className="team-actions" style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
  {amIInThisTeam ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontWeight: 'bold', color: 'var(--accent-green)', whiteSpace: 'nowrap' }}>Твоя команда</span>
      <button className="action-btn btn-leave" disabled={isGamePausedInLobby} onClick={() => socket.emit('leaveTeam', { roomCode: room.id })}>Вийти</button>
    </div>
  ) : !isFull ? (
    <button className="action-btn btn-join" disabled={isGamePausedInLobby} onClick={() => socket.emit('joinTeam', { roomCode: room.id, teamId: t.id })}>Увійти</button>
  ) : (
    <span className="muted">Заповнена</span>
  )}
  
  {isHost && !isGamePausedInLobby && (
    <button className="action-btn btn-delete" title="Видалити команду" onClick={() => handleDeleteTeam(t.id)}>❌</button>
  )}
</div>
                    </div>
                    
                    {isExpanded && renderTeamHistory(t.id)}
                  </div>
                );
              })}
            </div>
          </div>

          {renderPlayersList()}

          {isHost && !isGamePausedInLobby && (
              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                  <button className="ghost-btn" style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={handleResetGame}>
                      ⚠️ Скинути прогрес та рахунки
                  </button>
              </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
