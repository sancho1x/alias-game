import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

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

const playerId = getPersistentId();

function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [localTimer, setLocalTimer] = useState(0);

  useEffect(() => {
    socket.on('roomCreated', setRoom);
    socket.on('roomUpdated', (data) => { 
      setRoom(data); 
      setLocalTimer(data.gameState.timeLeft); 
    });
    socket.on('timerUpdate', setLocalTimer);
    socket.on('error', alert);

    const pingInterval = setInterval(() => {
      fetch(`${BACKEND_URL}/ping`).catch(() => {});
    }, 10 * 60 * 1000); 

    return () => {
      socket.removeAllListeners();
      clearInterval(pingInterval);
    };
  }, []);

  const handleCreateRoom = () => playerName && socket.emit('createRoom', { playerName, playerId });
  const handleJoinRoom = () => playerName && roomCode && socket.emit('joinRoom', { roomCode: roomCode.toUpperCase(), playerName, playerId });
  const updateSettings = (newSettings) => socket.emit('updateSettings', { roomCode: room.id, settings: { ...room.settings, ...newSettings } });
  
  const handleCreateTeam = () => { if (newTeamName) { socket.emit('createTeam', { roomCode: room.id, teamName: newTeamName }); setNewTeamName(''); } };
  const handleDeleteTeam = (teamId) => socket.emit('deleteTeam', { roomCode: room.id, teamId });
  const handleAdjustScore = (teamId, amount) => socket.emit('adjustScore', { roomCode: room.id, teamId, amount });
  const handleShuffleTeams = () => socket.emit('shuffleTeams', { roomCode: room.id });
  const handleResetGame = () => { if(window.confirm('Скинути всі рахунки та кола до нуля?')) socket.emit('resetGame', { roomCode: room.id }); };

  if (!room) {
    return (
      <div className="app-wrapper">
        <div className="container">
          <h1 className="logo-title">ALIAS UA</h1>
          <input type="text" placeholder="Нікнейм" value={playerName} onChange={e => setPlayerName(e.target.value)} />
          <button className="primary-btn" onClick={handleCreateRoom}>Створити кімнату</button>
          <div className="divider">АБО</div>
          <input type="text" placeholder="Код" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button className="secondary-btn" onClick={handleJoinRoom}>Увійти</button>
        </div>
      </div>
    );
  }

  const isHost = room.hostId === playerId;
  const currentTeam = room.teams[room.gameState.currentTeamIndex];
  const myPlayerInfo = room.players.find(p => p.playerId === playerId);

  const renderPlayersList = (compact = false) => (
    <div className="players-list">
      <h3>Гравці {compact && 'у кімнаті'}</h3>
      <ul style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {room.players.map(p => (
          <li key={p.playerId} style={{ opacity: p.online ? 1 : 0.5 }}>
            <span style={{ color: p.online ? 'inherit' : 'var(--text-muted)' }}>
              {p.name} {p.playerId === room.hostId && <span className="host-crown" title="Хост">👑</span>} 
              {!p.online && " (не в мережі)"}
            </span>
            <span className="muted" style={{ marginLeft: '10px' }}>
              {room.teams.find(t => t.id === p.teamId) ? `(${room.teams.find(t => t.id === p.teamId).name})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  // --- ЕКРАН ВІДЛІКУ 3.. 2.. 1.. ---
  if (room.gameState.status === 'countdown') {
    return (
      <div className="app-wrapper game-mode" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h2 style={{ color: 'white', marginBottom: '20px', fontSize: '2rem' }}>Готуйтесь!</h2>
        <h1 style={{ fontSize: '10rem', color: 'var(--accent-yellow)', margin: '0' }}>{localTimer}</h1>
      </div>
    );
  }

  // --- ЕКРАН ПАУЗИ ---
  if (room.gameState.status === 'paused') {
    const canResume = isHost || room.gameState.currentExplainerId === socket.id;
    return (
      <div className="app-wrapper game-mode" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h1 style={{ fontSize: '4rem', color: 'var(--accent-yellow)', marginBottom: '30px' }}>ПАУЗА</h1>
        {canResume ? (
          <button className="btn-correct" style={{ padding: '20px 40px', fontSize: '1.5rem' }} onClick={() => socket.emit('resumeGame', { roomCode: room.id })}>
            Продовжити гру
          </button>
        ) : (
          <p className="muted" style={{ fontSize: '1.2rem' }}>Очікуємо, поки ведучий зніме гру з паузи...</p>
        )}
      </div>
    );
  }

  // --- ЕКРАН ГРИ ---
  if (room.gameState.status === 'playing' || room.gameState.status === 'last_word') {
    const isExplainer = room.gameState.currentExplainerId === socket.id;
    const isMyTeamPlaying = room.gameState.currentTeamId === myPlayerInfo?.teamId;
    const isLast = room.gameState.status === 'last_word';
    
    return (
      <div className="app-wrapper game-mode">
        <div className="game-header">
          <div className="team-info-top">
            <span className="team-name">{currentTeam?.name}</span>
            <span className="team-live-score">Рахунок: {currentTeam?.score}</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {(isHost || isExplainer) && !isLast && (
              <button className="secondary-btn" style={{ padding: '8px 15px', fontSize: '1rem' }} onClick={() => socket.emit('pauseGame', { roomCode: room.id })}>
                ⏸ Пауза
              </button>
            )}
            <div className={`timer-display ${isLast ? 'timer-warning' : (localTimer < 10 ? 'timer-danger' : '')}`}>
              {isLast ? 'ОСТАННЄ' : localTimer}
            </div>
          </div>
        </div>
        
        <div className="game-board">
          {isExplainer ? (
            <>
              <div className="word-container"><h1 className="main-word">{room.gameState.currentWord}</h1></div>
              <div className="action-buttons">
                {!isLast && <button className="btn-skip" onClick={() => socket.emit('nextWord', { roomCode: room.id, isCorrect: false })}>Скіп (-1)</button>}
                <button className="btn-correct" onClick={() => socket.emit(isLast ? 'lastWordResult' : 'nextWord', { roomCode: room.id, isCorrect: true })}>Вгадали (+1)</button>
                {isLast && <button className="secondary-btn" onClick={() => socket.emit('lastWordResult', { roomCode: room.id, isCorrect: false })}>Не вгадали (0)</button>}
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
    );
  }

  // --- ЕКРАН ЗАВЕРШЕННЯ ХОДУ АБО ГРИ ---
  if (room.gameState.status === 'turn_ended' || room.gameState.status === 'game_over') {
    const isGameOver = room.gameState.status === 'game_over';
    const nextTeam = room.teams[room.gameState.currentTeamIndex];
    const nextTeamPlayers = room.players.filter(p => p.teamId === nextTeam?.id);
    const nextExplainerIdx = (room.gameState.explainerIndices[nextTeam?.id] || 0) % nextTeamPlayers.length;
    const nextGuesser = nextTeamPlayers[(nextExplainerIdx + 1) % nextTeamPlayers.length];
    
    // Тільки хост або ведучий минулого раунду можуть редагувати історію
    const canEditWords = isHost || socket.id === room.gameState.lastExplainerId;

    return (
      <div className="app-wrapper">
        <div className="container end-turn-container">
          {isGameOver ? (
            <h1 className="text-success" style={{ textAlign: 'center', marginBottom: '10px', fontSize: '2.5rem' }}>🏆 ГРА ЗАВЕРШЕНА!</h1>
          ) : (
            <h1 className="text-danger" style={{ textAlign: 'center', marginBottom: '10px' }}>Хід завершено! 🏁</h1>
          )}
          
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
            <div className="next-team-announcement">
              <h3>Наступні: <span className="text-success">{nextTeam?.name}</span></h3>
              <p className="muted" style={{ marginTop: '10px' }}>Відгадує: <strong>{nextGuesser?.name || '...'}</strong></p>
            </div>
          )}
          
          {isHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
              {!isGameOver && <button className="mega-btn" onClick={() => socket.emit('startTurn', { roomCode: room.id })}>▶ ПОЧАТИ ХІД</button>}
              <button className="ghost-btn" onClick={() => socket.emit('endGame', { roomCode: room.id })}>Повернутися в лобі</button>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: '20px', textAlign: 'center' }}>Очікуємо рішення хоста...</p>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />
          {renderPlayersList(true)}
        </div>
      </div>
    );
  }

  // --- ЛОБІ ТА НАЛАШТУВАННЯ ---
  // Розрахунок поточного кола:
  const currentLap = Math.floor(room.gameState.turnsTaken / (room.teams.length * 2 || 1)) + 1;
  const totalLapsDisplay = room.settings.laps === 'infinity' ? '∞' : room.settings.laps;

  return (
    <div className="app-wrapper">
      <div className="container">
        <div className="room-code-display" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Код: <strong>{room.id}</strong></span>
            <span style={{ color: 'var(--accent-yellow)' }}>Коло {currentLap} / {totalLapsDisplay}</span>
        </div>
        
        {isHost && room.teams.length > 0 && (
          <button className="mega-btn pulse" onClick={() => socket.emit('startTurn', { roomCode: room.id })}>▶ ПОЧАТИ ГРУ</button>
        )}

        <div className="settings-panel">
          <h3>Налаштування {isHost ? '⚙️' : '(Тільки хост)'}</h3>
          {isHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
              <label>Час раунду: 
                <select value={room.settings.timer} onChange={e => updateSettings({ timer: Number(e.target.value) })} style={{ marginTop: '5px' }}>
                  <option value="30">30 сек</option><option value="60">60 сек</option><option value="90">90 сек</option>
                </select>
              </label>
              
              <label>Словник: 
                <select value={room.settings.dictType} onChange={e => updateSettings({ dictType: e.target.value })} style={{ marginTop: '5px' }}>
                  <option value="easy">Лайт (Прості)</option><option value="medium">Медіум (Середні)</option>
                  <option value="hard">Хард (Складні)</option><option value="gamer">Геймерський</option>
                  <option value="custom">Свій словник</option>
                </select>
              </label>

              <label>Кількість кіл (до перемоги): 
                <select value={room.settings.laps} onChange={e => updateSettings({ laps: e.target.value })} style={{ marginTop: '5px' }}>
                  <option value="infinity">Безкінечно</option>
                  <option value="1">1 коло</option>
                  <option value="3">3 кола</option>
                  <option value="5">5 кіл</option>
                </select>
              </label>

              {room.settings.dictType === 'custom' && (
                <textarea 
                  placeholder="Введіть слова через пробіл або кому..." 
                  defaultValue={room.settings.customWords?.join(', ')} 
                  onBlur={e => updateSettings({ customWords: e.target.value.split(/[\s,]+/).filter(w => w) })}
                  style={{ minHeight: '100px', marginTop: '5px' }}
                />
              )}
            </div>
          ) : (
            <div className="read-only-settings" style={{ marginTop: '15px' }}>
              <p>Час: <strong>{room.settings.timer} сек</strong></p>
              <p>Словник: <strong>{
                room.settings.dictType === 'easy' ? 'Лайт' :
                room.settings.dictType === 'medium' ? 'Медіум' :
                room.settings.dictType === 'hard' ? 'Хард' :
                room.settings.dictType === 'gamer' ? 'Геймерський' : 'Свій словник'
              }</strong></p>
              <p>Кіл: <strong>{room.settings.laps === 'infinity' ? 'Безкінечно' : room.settings.laps}</strong></p>
            </div>
          )}
        </div>

        <div className="teams-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>{room.teams.some(t => t.score !== 0) ? '🏆 Турнірна таблиця' : 'Команди'}</h3>
            {isHost && room.players.filter(p => p.teamId).length > 0 && (
                <button className="secondary-btn" style={{ padding: '8px 15px', fontSize: '0.9rem' }} onClick={handleShuffleTeams}>🔀 Мікс</button>
            )}
          </div>
          
          <div className="input-group inline" style={{ marginBottom: '15px', marginTop: '15px' }}>
            <input type="text" placeholder="Назва команди" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
            <button onClick={handleCreateTeam}>+</button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[...room.teams].sort((a, b) => b.score - a.score).map(t => {
              const teamPlayers = room.players.filter(p => p.teamId === t.id);
              const isFull = teamPlayers.length >= 2;
              const amIInThisTeam = myPlayerInfo?.teamId === t.id;

              return (
                <div key={t.id} className="team-card">
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                      {t.name} <span className="muted" style={{ fontWeight: 'normal' }}>({teamPlayers.length}/2)</span>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                      {isHost && <button className="score-adjust" onClick={() => handleAdjustScore(t.id, -1)}>-</button>}
                      <strong className="score-pill">{t.score} балів</strong>
                      {isHost && <button className="score-adjust" onClick={() => handleAdjustScore(t.id, 1)}>+</button>}
                    </div>
                  </div>
                  <div className="team-actions">
                    {amIInThisTeam ? (
                      <span className="muted" style={{ fontWeight: 'bold', color: 'var(--accent-green)', paddingRight: '10px' }}>Твоя команда</span>
                    ) : !isFull ? (
                      <button className="join-btn" onClick={() => socket.emit('joinTeam', { roomCode: room.id, teamId: t.id })}>Увійти</button>
                    ) : <span className="muted" style={{ paddingRight: '10px' }}>Заповнена</span>}
                    {isHost && <button className="delete-btn" title="Видалити команду" onClick={() => handleDeleteTeam(t.id)}>❌</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {renderPlayersList()}

        {isHost && (
            <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <button className="ghost-btn" style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={handleResetGame}>
                    ⚠️ Скинути прогрес та рахунки
                </button>
            </div>
        )}
      </div>
    </div>
  );
}

export default App;
