import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// ПОСИЛАННЯ НА ТВІЙ БЕКЕНД
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
    socket.on('roomUpdated', (data) => { setRoom(data); setLocalTimer(data.gameState.timeLeft); });
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
  
  const updateSettings = (newSettings) => {
    socket.emit('updateSettings', { roomCode: room.id, settings: { ...room.settings, ...newSettings } });
  };

  const handleCreateTeam = () => {
    if (newTeamName) {
      socket.emit('createTeam', { roomCode: room.id, teamName: newTeamName });
      setNewTeamName('');
    }
  };

  const handleDeleteTeam = (teamId) => {
    socket.emit('deleteTeam', { roomCode: room.id, teamId });
  };

  if (!room) {
    return (
      <div className="app-wrapper">
        <div className="container">
          <h1 className="logo-title">ЕЛІАС</h1>
          <input type="text" placeholder="Нікнейм" value={playerName} onChange={e => setPlayerName(e.target.value)} />
          <button className="primary-btn" onClick={handleCreateRoom}>Створити кімнату</button>
          <div className="divider">АБО</div>
          <input type="text" placeholder="Код" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button className="secondary-btn" onClick={handleJoinRoom}>Увійти</button>
        </div>
      </div>
    );
  }

  // ТЕПЕР ХОСТ ПЕРЕВІРЯЄТЬСЯ ПО СТАБІЛЬНОМУ ID
  const isHost = room.hostId === playerId;
  const currentTeam = room.teams[room.gameState.currentTeamIndex];
  const myPlayerInfo = room.players.find(p => p.playerId === playerId);

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
          <div className={`timer-display ${isLast ? 'timer-warning' : (localTimer < 10 ? 'timer-danger' : '')}`}>
            {isLast ? 'ОСТАННЄ' : localTimer}
          </div>
        </div>
        
        <div className="game-board">
          {isExplainer ? (
            <>
              <div className="word-container">
                <h1 className="main-word">{room.gameState.currentWord}</h1>
              </div>
              <div className="action-buttons">
                {!isLast && <button className="btn-skip" onClick={() => socket.emit('nextWord', { roomCode: room.id, isCorrect: false })}>Скіп (-1)</button>}
                <button className="btn-correct" onClick={() => socket.emit(isLast ? 'lastWordResult' : 'nextWord', { roomCode: room.id, isCorrect: true })}>Вгадали</button>
                {isLast && <button className="btn-skip safe" onClick={() => socket.emit('lastWordResult', { roomCode: room.id, isCorrect: false })}>Завершити</button>}
              </div>
            </>
          ) : (
            <div className="guesser-view">
              <h1 style={{ color: isLast ? '#ffc312' : (isMyTeamPlaying ? '#ff4757' : '#a4b0be') }}>
                {isMyTeamPlaying ? 'Вгадуйте!' : `Грає команда: ${currentTeam?.name}`}
              </h1>
              
              <div className="word-history">
                {room.gameState.roundHistory.map((item, idx) => (
                  <span key={idx} className={`history-pill ${item.isCorrect ? 'correct' : 'skipped'}`}>
                    {item.word}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- ЕКРАН ЗАВЕРШЕННЯ ХОДУ ---
  if (room.gameState.status === 'turn_ended') {
    const nextTeam = room.teams[room.gameState.currentTeamIndex];
    return (
      <div className="app-wrapper">
        <div className="container end-turn-container">
          <h1 className="text-danger">Хід завершено! 🏁</h1>
          
          <div className="word-history" style={{ marginBottom: '20px' }}>
            {room.gameState.roundHistory.map((item, idx) => (
              <span key={idx} className={`history-pill ${item.isCorrect ? 'correct' : 'skipped'}`}>
                {item.word}
              </span>
            ))}
          </div>

          <div className="score-board">
            <h3>Поточний рахунок:</h3>
            {[...room.teams].sort((a, b) => b.score - a.score).map(t => (
              <div key={t.id} className="score-row">
                <span>{t.name}</span>
                <strong className="text-success">{t.score}</strong>
              </div>
            ))}
          </div>
          <h3 className="next-team-announcement">Наступна команда: {nextTeam?.name}</h3>
          
          {isHost ? (
            <>
              <button className="mega-btn" onClick={() => socket.emit('startTurn', { roomCode: room.id })}>▶ ПОЧАТИ ХІД</button>
              <button className="ghost-btn" style={{ marginTop: '15px' }} onClick={() => socket.emit('endGame', { roomCode: room.id })}>
                Налаштування / В лобі
              </button>
            </>
          ) : (
            <p className="muted" style={{ marginTop: '20px' }}>Очікуємо, поки хост запустить раунд...</p>
          )}
        </div>
      </div>
    );
  }

  // --- ЛОБІ ТА НАЛАШТУВАННЯ ---
  return (
    <div className="app-wrapper">
      <div className="container">
        <div className="room-code-display">Код кімнати: <strong>{room.id}</strong></div>
        
        {isHost && room.teams.length > 0 && (
          <button className="mega-btn pulse" onClick={() => socket.emit('startTurn', { roomCode: room.id })}>▶ ПОЧАТИ ГРУ</button>
        )}

        <div className="settings-panel">
          <h3>Налаштування {isHost ? '⚙️' : '(Тільки хост)'}</h3>
          {isHost ? (
            <>
              <label>Час: 
                <select value={room.settings.timer} onChange={e => updateSettings({ timer: Number(e.target.value) })}>
                  <option value="30">30 сек</option>
                  <option value="60">60 сек</option>
                  <option value="90">90 сек</option>
                </select>
              </label>
              <label>Словник: 
                <select value={room.settings.dictType} onChange={e => updateSettings({ dictType: e.target.value })}>
                  <option value="easy">Лайт (Прості)</option>
                  <option value="medium">Медіум (Середні)</option>
                  <option value="hard">Хард (Складні)</option>
                  <option value="gamer">Геймерський</option>
                  <option value="custom">Свій словник</option>
                </select>
              </label>
              {room.settings.dictType === 'custom' && (
                <textarea 
                  placeholder="Слова через пробіл або кому..." 
                  defaultValue={room.settings.customWords?.join(', ')} 
                  onBlur={e => updateSettings({ customWords: e.target.value.split(/[\s,]+/).filter(w => w) })}
                />
              )}
            </>
          ) : (
            <div className="read-only-settings">
              <p>Час раунду: <strong>{room.settings.timer} сек</strong></p>
              <p>Словник: <strong>{
                room.settings.dictType === 'easy' ? 'Лайт' :
                room.settings.dictType === 'medium' ? 'Медіум' :
                room.settings.dictType === 'hard' ? 'Хард' :
                room.settings.dictType === 'gamer' ? 'Геймерський' : 'Свій словник'
              }</strong></p>
            </div>
          )}
        </div>

        <div className="teams-list">
          <h3>{room.teams.some(t => t.score !== 0) ? '🏆 Турнірна таблиця' : 'Команди'}</h3>
          
          <div className="input-group inline">
            <input type="text" placeholder="Назва команди" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
            <button onClick={handleCreateTeam}>+</button>
          </div>
          
          {[...room.teams].sort((a, b) => b.score - a.score).map(t => {
            const teamPlayers = room.players.filter(p => p.teamId === t.id);
            const isFull = teamPlayers.length >= 2;
            const amIInThisTeam = myPlayerInfo?.teamId === t.id;

            return (
              <div key={t.id} className="team-card">
                <span>
                  {t.name} <span className="muted">({teamPlayers.length}/2)</span>
                  <strong style={{ 
                    marginLeft: '12px', 
                    color: 'var(--accent-green)', 
                    backgroundColor: 'rgba(46, 213, 115, 0.15)',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '1rem'
                  }}>
                    {t.score} балів
                  </strong>
                </span>
                
                <div className="team-actions">
                  {amIInThisTeam ? (
                    <span className="muted" style={{ fontWeight: 'bold', color: 'var(--accent-green)', paddingRight: '10px' }}>Твоя команда</span>
                  ) : !isFull ? (
                    <button className="join-btn" onClick={() => socket.emit('joinTeam', { roomCode: room.id, teamId: t.id })}>Увійти</button>
                  ) : (
                    <span className="muted" style={{ paddingRight: '10px' }}>Заповнена</span>
                  )}
                  
                  {isHost && (
                    <button className="delete-btn" title="Видалити команду" onClick={() => handleDeleteTeam(t.id)}>❌</button>
                  )}
                </div>

              </div>
            );
          })}
        </div>

        <div className="players-list">
          <h3>Гравці</h3>
          <ul>
            {/* ТУТ КОРОНА МАЛЮЄТЬСЯ ПО playerId */}
            {room.players.map(p => (
              <li key={p.playerId}>
                <span style={{ color: p.online ? 'inherit' : 'var(--text-muted)' }}>
                  {p.name} {p.playerId === room.hostId && <span className="host-crown" title="Хост кімнати">👑</span>} 
                  {!p.online && " (не в мережі)"}
                </span>
                <span className="muted">
                  {room.teams.find(t => t.id === p.teamId) ? ` (${room.teams.find(t => t.id === p.teamId).name})` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
