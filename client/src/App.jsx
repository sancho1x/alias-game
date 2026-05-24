import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// 🚨🚨 ВСТАВ СВІЙ CLIENT ID З TWITCH DEVELOPER CONSOLE ТУТ 🚨🚨
const TWITCH_CLIENT_ID = 'fh66pb8rdh6mr32melibkiybfvhipr'; 
const REDIRECT_URI = window.location.origin;

const BACKEND_URL = 'https://alias-game-2oys.onrender.com';
const socket = io(BACKEND_URL);

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
  const [playerName, setPlayerName] = useState('');
  const [isTwitchAuth, setIsTwitchAuth] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [localTimer, setLocalTimer] = useState(0);
  
  const [appError, setAppError] = useState('');
  
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const [expandedTeams, setExpandedTeams] = useState({});

  const currentPlayerId = isTwitchAuth ? `twitch_${playerName}` : basePlayerId;

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
           const twitchName = data.data[0].display_name;
           localStorage.setItem('alias_twitch_name', twitchName);
           
           if (window.opener) {
               window.close();
           } else {
               setPlayerName(twitchName);
               setIsTwitchAuth(true);
               // 🔥 АВТОВХІД: Якщо є збережена кімната - одразу залітаємо
               if (pendingRoom) {
                   socket.emit('joinRoom', { roomCode: pendingRoom, playerName: twitchName, playerId: basePlayerId, isTwitchAuth: true, twitchToken: token });
                   localStorage.removeItem('alias_pending_room');
               }
           }
        }
      }).catch(err => console.error("Помилка Twitch", err));
    } else {
       const savedTwitchName = localStorage.getItem('alias_twitch_name');
       if (savedTwitchName) {
           setPlayerName(savedTwitchName);
           setIsTwitchAuth(true);
           // 🔥 АВТОВХІД: Якщо гравець вже був залогінений - одразу залітаємо
           if (pendingRoom) {
               socket.emit('joinRoom', { roomCode: pendingRoom, playerName: savedTwitchName, playerId: basePlayerId, isTwitchAuth: true, twitchToken: localStorage.getItem('alias_twitch_token') });
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
    
    socket.on('error', (msg) => {
        setAppError(msg);
        setTimeout(() => setAppError(''), 4000);
    });

socket.on('kicked', () => {
        setRoom(null);
        setRoomCode('');
        setAppError('Вас вигнали з кімнати!');
        setTimeout(() => setAppError(''), 5000);
    });

    socket.on('kicked_duplicate', () => {
        setRoom(null);
        setRoomCode('');
        setAppError('Виконано вхід з іншого пристрою! Вас відключено.');
        setTimeout(() => setAppError(''), 7000); // Даємо 7 секунд, щоб точно встигли прочитати
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
    window.open(url, 'TwitchAuth', `width=${width},height=${height},left=${left},top=${top}`);
  };

const handleTwitchLogout = () => {
    localStorage.removeItem('alias_twitch_name');
    localStorage.removeItem('alias_twitch_token'); // 🔥 НОВИЙ РЯДОК
    setPlayerName('');
    setIsTwitchAuth(false);
  };

const handleCreateRoom = () => {
    const token = localStorage.getItem('alias_twitch_token'); // 🔥 Беремо токен
    socket.emit('createRoom', { playerName, playerId: basePlayerId, isTwitchAuth, twitchToken: token });
  };

const handleJoinRoom = () => {
    if (roomCode.length !== 4) return;
    const token = localStorage.getItem('alias_twitch_token'); 
    socket.emit('joinRoom', { roomCode: roomCode.toUpperCase(), playerName, playerId: basePlayerId, isTwitchAuth, twitchToken: token });
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

const handleStartGameLobby = () => {
    const maxTurns = room.settings.laps === 'infinity' ? Infinity : parseInt(room.settings.laps) * (room.teams.length * 2 || 1);
    if (maxTurns !== Infinity && room.gameState.turnsTaken >= maxTurns) {
        if (window.confirm('Гру вже завершено! Бажаєте скинути рахунки і почати нове коло?')) {
            socket.emit('resetGame', { roomCode: room.id });
            setTimeout(() => {
                if (room.players.some(p => p.teamId !== null && !p.online)) {
                    setAppError('Один з гравців у командах не в мережі! Дочекайтесь його.');
                    setTimeout(() => setAppError(''), 4000);
                    return;
                }
                socket.emit('startTurn', { roomCode: room.id });
            }, 500);
        }
        return;
    }

    // 🔥 НОВИЙ КОД: Перевірка словника в лобі
    if (room.settings.dictType === 'custom') {
        const wordCount = room.settings.customWords?.length || 0;
        if (wordCount < 50) {
            setAppError(`Для свого словника потрібно мінімум 50 слів! (Зараз: ${wordCount})`);
            setTimeout(() => setAppError(''), 4000);
            return;
        }
    }

    if (room.players.some(p => p.teamId !== null && !p.online)) {
        setAppError('Один з гравців у командах не в мережі! Дочекайтесь його або замініть.');
        setTimeout(() => setAppError(''), 4000);
        return;
    }
    socket.emit('startTurn', { roomCode: room.id });
  };

  const handleStartTurnFromScoreboard = () => {
      // 🔥 НОВИЙ КОД: Перевірка словника на екрані результатів
      if (room.settings.dictType === 'custom') {
          const wordCount = room.settings.customWords?.length || 0;
          if (wordCount < 50) {
              setAppError(`Для свого словника потрібно мінімум 50 слів! (Зараз: ${wordCount})`);
              setTimeout(() => setAppError(''), 4000);
              return;
          }
      }

      if (room.players.some(p => p.teamId !== null && !p.online)) {
          setAppError('Один з гравців у командах не в мережі! Дочекайтесь його.');
          setTimeout(() => setAppError(''), 4000);
          return;
      }
      socket.emit('startTurn', { roomCode: room.id });
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

if (!room) {
    return (
      <>
        <ErrorToast />
        <div className="app-wrapper">
          <div className="container">
            <h1 className="logo-title">ЕЛІАС</h1>

            {/* 🔥 НОВИЙ КОД: Попередження про сплячий сервер */}
            <div style={{
                backgroundColor: 'rgba(255, 195, 18, 0.05)',
                border: '1px dashed rgba(255, 195, 18, 0.3)',
                color: 'var(--text-muted)',
                padding: '12px 15px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                textAlign: 'center',
                marginBottom: '20px',
                lineHeight: '1.4'
            }}>
              ⏳ <strong>Сервер може спати:</strong> Якщо гра довго не запускалася, їй треба близько 30-50 секунд, щоб "прокинутися". Якщо кнопки не реагують одразу — просто трошки почекайте!
            </div>
            
            {isTwitchAuth ? (
              <div style={{ textAlign: 'center', backgroundColor: '#3d4554', padding: '15px', borderRadius: '12px' }}>
                <p style={{ marginBottom: '10px' }}>Увійшли через Twitch як: <strong style={{ color: '#a970ff' }}>{playerName}</strong></p>
                <button className="ghost-btn" style={{ padding: '8px 15px', fontSize: '0.9rem' }} onClick={handleTwitchLogout}>Вийти з Twitch</button>
              </div>
            ) : (
              <>
                <input type="text" placeholder="Нікнейм" value={playerName} onChange={e => setPlayerName(e.target.value)} />
                <button style={{ backgroundColor: '#a970ff', color: 'white' }} onClick={handleTwitchLogin}>📺 Увійти через Twitch</button>
              </>
            )}

            <div className="divider">Створити гру</div>
            <button className="primary-btn" onClick={handleCreateRoom} disabled={!playerName}>Створити кімнату</button>
            
            <div className="divider">АБО</div>
            <input type="text" placeholder="Введіть код" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button className="secondary-btn" onClick={handleJoinRoom} disabled={!playerName || !roomCode}>Увійти в кімнату</button>
          </div>
        </div>
      </>
    );
  }
  
// 🔥 НОВИЙ КОД: Звук відліку тільки для активних гравців
  useEffect(() => {
    // Спрацьовує тільки коли статус змінюється на countdown і таймер на 3
    if (room?.gameState?.status === 'countdown' && localTimer === 3) {
      
      // Шукаємо команду і гравців, чий зараз хід
      const activeTeam = room.teams.find(t => t.id === room.gameState.currentTeamId);
      const teamPlayers = room.players.filter(p => p.teamId === activeTeam?.id);
      const activeExplainer = room.players.find(p => p.id === room.gameState.currentExplainerId);
      const expIdx = teamPlayers.findIndex(p => p.id === activeExplainer?.id);
      const activeGuesser = teamPlayers[(expIdx + 1) % (teamPlayers.length || 1)];

      // Перевіряємо, чи Я є пояснювачем АБО відгадувачем
      const amIActive = currentPlayerId === activeExplainer?.playerId || currentPlayerId === activeGuesser?.playerId;

      if (amIActive) {
        const audio = new Audio('/countdown.mp3'); // Назва твого аудіофайлу
        audio.volume = 0.6; // Гучність від 0.0 до 1.0 (щоб не оглушити)
        audio.play().catch(err => console.log('Автоплей заблоковано браузером:', err));
      }
    }
  }, [room?.gameState?.status, localTimer, currentPlayerId, room]);
  
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
                {p.isTwitch && <span style={{ marginRight: '5px' }} title="Авторизований через Twitch">📺</span>}
                {p.name} {p.playerId === room.hostId && <span className="host-crown" title="Хост">👑</span>} 
                {!p.online && " (не в мережі)"}
              </span>
              <span className="muted" style={{ marginLeft: '10px' }}>
                {room.teams.find(t => t.id === p.teamId) ? `(${room.teams.find(t => t.id === p.teamId).name})` : ''}
              </span>
            </div>
            
            {/* 🔥 НОВИЙ КОД: Блок з кнопками передачі хоста та кіку */}
            {isHost && p.playerId !== currentPlayerId && !compact && (
                <div style={{ display: 'flex', gap: '5px' }}>
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
        <div className="app-wrapper game-mode">
          <div className="game-header">
            <div className="team-info-top" style={{ display: 'flex', gap: '15px', alignItems: 'center', fontSize: '1.2rem' }}>
              <span className="team-name" style={{ fontWeight: 'bold' }}>{currentTeam?.name}</span>
              <span className="team-live-score" style={{ color: 'var(--text-muted)' }}>
                Рахунок: <strong style={{ color: 'var(--accent-green)' }}>{currentTeam?.score}</strong>
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {(isHost || isExplainer) && !isLast && (
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
          
          <div className="game-board">
            {isExplainer ? (
              <>
                <div className="word-container"><h1 className="main-word">{room.gameState.currentWord}</h1></div>
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
              <div className="guesser-view">
                <h1 style={{ color: isLast ? '#ffc312' : (isMyTeamPlaying ? '#ff4757' : '#a4b0be') }}>
                  {isMyTeamPlaying ? 'Вгадуйте!' : `Грає команда: ${currentTeam?.name}`}
                </h1>
                <div className="word-history">
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
                    onChange={e => updateSettings({ timer: Number(e.target.value) || 60 })} 
                    style={{ marginTop: '8px', width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' }} 
                  />
                </label>
                
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>Словник: 
                  <select value={room.settings.dictType} onChange={e => updateSettings({ dictType: e.target.value })} style={{ marginTop: '8px', width: '100%' }}>
                    <option value="easy">Лайт (Прості)</option><option value="medium">Медіум (Середні)</option>
                    <option value="hard">Хард (Складні)</option><option value="gamer">Геймерський</option>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
                          <span 
                            style={{ fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none' }}
                            onClick={() => setExpandedTeams(prev => ({...prev, [t.id]: !prev[t.id]}))}
                            title="Натисни, щоб переглянути історію раундів"
                          >
                            <span style={{ fontSize: '1.2rem', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            {t.name} <span className="muted" style={{ fontWeight: 'normal' }}>({teamPlayers.length}/2)</span>
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '25px' }}>
                            {isHost && <button className="score-adjust" onClick={() => handleAdjustScore(t.id, -1)}>-</button>}
                            <strong className="score-pill">{t.score} балів</strong>
                            {isHost && <button className="score-adjust" onClick={() => handleAdjustScore(t.id, 1)}>+</button>}
                          </div>
                        </div>

                        {/* 🔥 НОВИЙ КОД: Кнопка "Вийти", якщо гравець у цій команді */}
<div className="team-actions" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
  {amIInThisTeam ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span className="muted" style={{ fontWeight: 'bold', color: 'var(--accent-green)' }}>Твоя команда</span>
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
