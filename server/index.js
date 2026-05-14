const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// 🚨🚨 ТУТ ТЕПЕР ТІЛЬКИ ЗМІННА ОТОЧЕННЯ 🚨🚨
const MONGO_URI = process.env.MONGO_URI;

if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
      .then(() => console.log('✅ Підключено до MongoDB'))
      .catch(err => console.error('❌ Помилка MongoDB:', err));
} else {
    console.warn('⚠️ MONGO_URI не знайдено, працюємо без бази даних');
}

const roomSchema = new mongoose.Schema({
  id: String,
  hostId: String,
  lastActive: Number,
  players: Array,
  teams: Array,
  settings: Object,
  gameState: Object,
  kickedPlayers: Array // Список забанених ID
}, { strict: false });

const RoomModel = mongoose.model('Room', roomSchema);

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const MAX_ROOMS = 100; 
const ROOM_TIMEOUT = 2 * 60 * 60 * 1000; 

RoomModel.find({}).then(dbRooms => {
  dbRooms.forEach(r => {
    if (Date.now() - r.lastActive < ROOM_TIMEOUT) {
        const room = r.toObject();
        room.timerInterval = null;
        room.hostTimeoutObj = null;
        if (room.gameState.status === 'playing' || room.gameState.status === 'countdown') {
            room.gameState.status = 'paused';
            room.gameState.pausedState = 'active_turn';
        }
        rooms[r.id] = room;
    } else {
        RoomModel.deleteOne({ id: r.id }).catch(()=>({}));
    }
  });
  console.log(`📦 Відновлено кімнат з бази: ${Object.keys(rooms).length}`);
});

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

const getSafeRoom = (room) => {
  const { timerInterval, hostTimeoutObj, ...safeRoom } = room;
  return safeRoom;
};

const broadcastRoomUpdate = (roomCode) => {
  const room = rooms[roomCode];
  if (room) {
    const safeRoom = getSafeRoom(room);
    io.to(roomCode).emit('roomUpdated', safeRoom);
    if (MONGO_URI) {
        RoomModel.findOneAndUpdate({ id: room.id }, safeRoom, { upsert: true }).catch(err => console.log('Помилка БД:', err));
    }
  }
};

const touchRoom = (roomCode) => {
  if (rooms[roomCode]) {
    rooms[roomCode].lastActive = Date.now();
  }
};

setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    if (now - rooms[code].lastActive > ROOM_TIMEOUT) {
      delete rooms[code];
      if (MONGO_URI) RoomModel.deleteOne({ id: code }).catch(()=>({})); 
    }
  }
}, 30 * 60 * 1000);

const dictionaries = {
  easy: "Яблуко Телевізор Кіт Стілець Молоко Поїзд Сонце Книга Машина Огірок Кросівки Телефон Море Літак Дерево Вікно Собака Двері Ручка Зошит Стіл Шафа Лампа Квітка Трава Небо Хмара Дощ Сніг Зима Літо Осінь Весна Річка Озеро Гора Ліс Птах Риба Хліб Масло Сир Ковбаса Чай Кава Вода Сік Цукор Сіль".split(" "),
  medium: "Авангард Адекватність Ажіотаж Акваторія Акліматизація Алгоритм Альтернатива Амбіція Аналіз Аномалія Апетит Аристократ Арсенал Архітектура Асиметрія Асортимент Атмосфера Аудиторія Барикада Безмежність Біографія Блокнот Бульвар Вакансія Вакуум Вентиляція Вердикт Вертикаль Вібрація Візаж".split(" "),
  hard: "Диверсифікація Екзистенціалізм Синхрофазотрон Метаморфоза Абстракція Інтроспекція Когнітивний Прокрастинація Конгруентність Асиміляція Фрустрація Парадокс Емансипація Трансцендентний Дезоксирибонуклеїнова Амплітуда Сингулярність Біфуркація Екстраполяція Детермінізм".split(" "),
  gamer: "Рогалик Стім Рейд Хедшот Лут Геймпад Фпс Текстура Сейв Моб Крафт Манна Кулдаун Нерф Бафф Дебафф Агро Хіл Дпс Танк Саппорт Керрі Пуш Деф Фарм Грінд Дроп Спавн Респаун Квест Нпс Бос Мінібос Ачівка Скіл Перк Білд Стати Експа Левел Апгрейд Донат".split(" ")
};

io.on('connection', (socket) => {
  
  socket.on('createRoom', ({ playerName, playerId, isTwitchAuth }) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) return socket.emit('error', 'Сервери перевантажені!');
    const roomCode = generateRoomCode();
    // Визначаємо залізобетонний ID
    const effectivePlayerId = isTwitchAuth ? `twitch_${playerName}` : playerId;

    rooms[roomCode] = {
      id: roomCode,
      hostId: effectivePlayerId,
      lastActive: Date.now(),
      players: [{ id: socket.id, playerId: effectivePlayerId, name: playerName, teamId: null, online: true, isTwitch: isTwitchAuth }],
      teams: [],
      kickedPlayers: [],
      settings: { timer: 60, dictType: 'medium', customWords: [], laps: 'infinity', requireTwitchAuth: false },
      gameState: { 
        status: 'lobby', currentTeamIndex: 0, explainerIndices: {}, currentWord: '', 
        timeLeft: 60, targetTime: 60, usedWords: [], roundHistory: [], turnsTaken: 0,
        lastExplainerId: null, lastTeamId: null, pausedState: null, autoPausedBySystem: false
      },
      timerInterval: null,
      hostTimeoutObj: null
    };
    socket.join(roomCode);
    socket.emit('roomCreated', getSafeRoom(rooms[roomCode]));
    if (MONGO_URI) RoomModel.findOneAndUpdate({ id: roomCode }, getSafeRoom(rooms[roomCode]), { upsert: true }).catch(()=>{});
  });

  socket.on('joinRoom', ({ roomCode, playerName, playerId, isTwitchAuth }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Кімнату не знайдено.');
    touchRoom(roomCode);
    
    // Формуємо справжній ID
    const effectivePlayerId = isTwitchAuth ? `twitch_${playerName}` : playerId;

    // Перевірка на бан
    if (room.kickedPlayers.includes(effectivePlayerId)) {
        return socket.emit('error', 'Вас було виключено з цієї кімнати.');
    }

    if (room.settings.requireTwitchAuth && !isTwitchAuth) {
        return socket.emit('error', 'Хост увімкнув обов\'язковий вхід через Twitch!');
    }

    const existing = room.players.find(p => p.playerId === effectivePlayerId);

    if (existing) {
      const oldId = existing.id;
      existing.id = socket.id;
      existing.name = playerName;
      existing.online = true;
      existing.isTwitch = isTwitchAuth || existing.isTwitch;
      
      if (room.gameState.currentExplainerId === oldId) room.gameState.currentExplainerId = socket.id;
      if (room.gameState.lastExplainerId === oldId) room.gameState.lastExplainerId = socket.id;

      // Якщо хост повернувся
      if (room.hostId === effectivePlayerId && room.hostTimeoutObj) {
          clearTimeout(room.hostTimeoutObj);
          room.hostTimeoutObj = null;
          
          // Авто-знімання з паузи, якщо пауза була викликана системою через виліт
          if (room.gameState.status === 'paused' && room.gameState.autoPausedBySystem) {
              room.gameState.autoPausedBySystem = false;
              room.gameState.pausedState = null;
              room.gameState.status = 'countdown';
              room.gameState.timeLeft = 3;
              if (room.gameState.currentWord === '' || room.gameState.currentWord === 'Готуйтесь!') {
                 room.gameState.currentWord = room.gameState.usedWords[room.gameState.usedWords.length - 1] || getRandomWord(room);
              }
              runTimer(room);
          }
      }

    } else {
      room.players.push({ id: socket.id, playerId: effectivePlayerId, name: playerName, teamId: null, online: true, isTwitch: isTwitchAuth });
    }
    
    if (!room.hostId || !room.players.find(p => p.playerId === room.hostId && p.online)) {
      room.hostId = effectivePlayerId;
    }
    
    socket.join(roomCode);
    broadcastRoomUpdate(roomCode);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.online = false;
        
        // Перевірка, чи не вилетів гравець, який зараз грає
        const isExplainer = room.gameState.currentExplainerId === socket.id;
        const isGuesser = room.gameState.currentTeamId === player.teamId;
        
        if ((isExplainer || isGuesser) && ['playing', 'countdown'].includes(room.gameState.status)) {
            clearInterval(room.timerInterval);
            if (room.gameState.status !== 'countdown') {
                room.gameState.targetTime = room.gameState.timeLeft;
            }
            room.gameState.status = 'paused';
            room.gameState.autoPausedBySystem = true;
        }

        // Перевірка, чи вилетів ХОСТ
        if (room.hostId === player.playerId) {
            // Даємо 60 секунд на реконект
            room.hostTimeoutObj = setTimeout(() => {
                const nextHost = room.players.find(p => p.playerId !== player.playerId && p.online);
                room.hostId = nextHost ? nextHost.playerId : null;
                room.hostTimeoutObj = null;
                broadcastRoomUpdate(code);
            }, 60000);
        }
        
        broadcastRoomUpdate(code);
        break;
      }
    }
  });

  socket.on('kickPlayer', ({ roomCode, targetPlayerId }) => {
    const room = rooms[roomCode];
    const host = room?.players.find(p => p.id === socket.id);
    if (room && host && room.hostId === host.playerId) {
        const targetPlayer = room.players.find(p => p.playerId === targetPlayerId);
        if (targetPlayer && targetPlayer.playerId !== room.hostId) {
            room.kickedPlayers.push(targetPlayer.playerId);
            room.players = room.players.filter(p => p.playerId !== targetPlayer.playerId);
            // Примусово розриваємо йому з'єднання
            io.to(targetPlayer.id).emit('kicked');
            const targetSocket = io.sockets.sockets.get(targetPlayer.id);
            if (targetSocket) targetSocket.leave(roomCode);
            broadcastRoomUpdate(roomCode);
        }
    }
  });

  socket.on('updateSettings', ({ roomCode, settings }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
      touchRoom(roomCode);
      room.settings = { ...room.settings, ...settings };
      room.gameState.usedWords = [];
      broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('createTeam', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (room) {
      touchRoom(roomCode);
      const newTeam = { id: Date.now().toString(), name: teamName, score: 0 };
      room.teams.push(newTeam);
      room.gameState.explainerIndices[newTeam.id] = 0;
      broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('joinTeam', ({ roomCode, teamId }) => {
    const room = rooms[roomCode];
    if (room) {
      touchRoom(roomCode);
      const player = room.players.find(p => p.id === socket.id);
      const playersInTeam = room.players.filter(p => p.teamId === teamId);
      if (player && player.teamId !== teamId && playersInTeam.length >= 2) return socket.emit('error', 'Команда вже заповнена');
      if (player) player.teamId = teamId;
      broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('deleteTeam', ({ roomCode, teamId }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
      touchRoom(roomCode);
      room.teams = room.teams.filter(t => t.id !== teamId);
      room.players.forEach(p => { if (p.teamId === teamId) p.teamId = null; });
      broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('shuffleTeams', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
        touchRoom(roomCode);
        const teamPlayers = room.players.filter(p => p.teamId !== null);
        for (let i = teamPlayers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teamPlayers[i], teamPlayers[j]] = [teamPlayers[j], teamPlayers[i]];
        }
        let pIdx = 0;
        for (const team of room.teams) {
            room.players.forEach(p => { if(p.teamId === team.id) p.teamId = null; });
            if (pIdx < teamPlayers.length) teamPlayers[pIdx++].teamId = team.id;
            if (pIdx < teamPlayers.length) teamPlayers[pIdx++].teamId = team.id;
        }
        broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('adjustScore', ({ roomCode, teamId, amount }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
      const team = room.teams.find(t => t.id === teamId);
      if (team) {
        team.score += amount;
        broadcastRoomUpdate(roomCode);
      }
    }
  });

  socket.on('resetGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
        touchRoom(roomCode);
        room.gameState.turnsTaken = 0;
        room.gameState.currentTeamIndex = 0;
        room.gameState.explainerIndices = {};
        room.teams.forEach(t => t.score = 0);
        room.gameState.usedWords = [];
        room.gameState.pausedState = null;
        broadcastRoomUpdate(roomCode);
    }
  });

  const getRandomWord = (room) => {
    let pool = [];
    if (room.settings.dictType === 'custom') {
      pool = room.settings.customWords && room.settings.customWords.length > 0 ? room.settings.customWords : ["СЛОВНИК", "ПОРОЖНІЙ"];
    } else {
      pool = dictionaries[room.settings.dictType] || dictionaries.easy;
    }
    let availableWords = pool.filter(w => !room.gameState.usedWords.includes(w));
    if (availableWords.length === 0) {
      room.gameState.usedWords = [];
      availableWords = pool;
    }
    const word = availableWords[Math.floor(Math.random() * availableWords.length)];
    room.gameState.usedWords.push(word);
    return word;
  };

  const runTimer = (room) => {
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      room.gameState.timeLeft -= 1;
      
      if (room.gameState.status === 'countdown') {
        if (room.gameState.timeLeft > 0) {
          io.to(room.id).emit('timerUpdate', room.gameState.timeLeft);
        } else {
          room.gameState.status = 'playing';
          room.gameState.timeLeft = room.gameState.targetTime;
          
          if (room.gameState.currentWord === 'Готуйтесь!' || room.gameState.currentWord === '') {
              room.gameState.currentWord = getRandomWord(room);
          }
          
          broadcastRoomUpdate(room.id);
          io.to(room.id).emit('timerUpdate', room.gameState.timeLeft);
        }
      } else if (room.gameState.status === 'playing') {
        io.to(room.id).emit('timerUpdate', room.gameState.timeLeft);
        if (room.gameState.timeLeft <= 0) {
          clearInterval(room.timerInterval);
          room.gameState.status = 'last_word';
          broadcastRoomUpdate(room.id);
        }
      }
    }, 1000);
  };

  socket.on('startTurn', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || room.hostId !== player.playerId) return;
    touchRoom(roomCode);

    if (room.teams.length === 0) return socket.emit('error', 'Створіть команди');
    for (const team of room.teams) {
      if (room.players.filter(p => p.teamId === team.id).length < 2) return socket.emit('error', `У команді "${team.name}" треба 2 гравці`);
    }

    room.gameState.status = 'countdown';
    room.gameState.timeLeft = 3;
    room.gameState.targetTime = room.settings.timer;
    room.gameState.roundHistory = []; 
    
    if (room.gameState.currentTeamIndex >= room.teams.length) room.gameState.currentTeamIndex = 0;
    
    const currentTeam = room.teams[room.gameState.currentTeamIndex];
    room.gameState.currentTeamId = currentTeam.id;

    const teamPlayers = room.players.filter(p => p.teamId === currentTeam.id);
    let expIdx = (room.gameState.explainerIndices[currentTeam.id] || 0) % teamPlayers.length;
    room.gameState.currentExplainerId = teamPlayers[expIdx].id;

    room.gameState.currentWord = 'Готуйтесь!';
    broadcastRoomUpdate(roomCode);
    runTimer(room);
  });

  socket.on('pauseGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || (room.hostId !== player.playerId && room.gameState.currentExplainerId !== socket.id)) return;
    
    if (room.gameState.status === 'playing' || room.gameState.status === 'last_word') {
        clearInterval(room.timerInterval);
        room.gameState.targetTime = room.gameState.timeLeft; 
        room.gameState.status = 'paused';
        room.gameState.autoPausedBySystem = false; // Зняття прапорця системи, бо це ручна пауза
        broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('returnToLobby', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || (room.hostId !== player.playerId && room.gameState.currentExplainerId !== socket.id)) return;
    
    if (['playing', 'last_word', 'paused', 'countdown'].includes(room.gameState.status)) {
        clearInterval(room.timerInterval);
        if (room.gameState.status !== 'countdown' && room.gameState.status !== 'paused') {
             room.gameState.targetTime = room.gameState.timeLeft;
        }
        room.gameState.pausedState = 'active_turn'; 
        room.gameState.status = 'lobby';
        broadcastRoomUpdate(roomCode);
    }
  });
  
  socket.on('resumeGame', ({ roomCode, action }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player) return;
    if (room.gameState.status === 'lobby' && room.hostId !== player.playerId) return;
    if (room.gameState.status === 'paused' && room.hostId !== player.playerId && room.gameState.currentExplainerId !== socket.id) return;
    
    if (room.gameState.status === 'paused' || (room.gameState.status === 'lobby' && room.gameState.pausedState === 'active_turn')) {
        room.gameState.autoPausedBySystem = false;
        
        if (action === 'restart_turn') {
            const team = room.teams.find(t => t.id === room.gameState.currentTeamId);
            if (team) {
                room.gameState.roundHistory.forEach(item => {
                    if (item.status === 'correct') team.score -= 1;
                    if (item.status === 'skipped') team.score += 1;
                });
            }
            room.gameState.pausedState = null;
            room.gameState.status = 'countdown';
            room.gameState.timeLeft = 3;
            room.gameState.targetTime = room.settings.timer; 
            room.gameState.roundHistory = []; 
            room.gameState.currentWord = 'Готуйтесь!';
        } else {
            room.gameState.pausedState = null;
            room.gameState.status = 'countdown';
            room.gameState.timeLeft = 3;
            if (room.gameState.currentWord === '' || room.gameState.currentWord === 'Готуйтесь!') {
                 room.gameState.currentWord = room.gameState.usedWords[room.gameState.usedWords.length - 1] || getRandomWord(room);
            }
        }
        broadcastRoomUpdate(roomCode);
        runTimer(room);
    }
  });

  socket.on('nextWord', ({ roomCode, isCorrect }) => {
    const room = rooms[roomCode];
    if (room && room.gameState.status === 'playing') {
      touchRoom(roomCode);
      if (room.gameState.currentExplainerId !== socket.id) return;
      
      const team = room.teams.find(t => t.id === room.gameState.currentTeamId);
      if (isCorrect) team.score += 1; else team.score -= 1;
      
      room.gameState.roundHistory.push({
        word: room.gameState.currentWord,
        status: isCorrect ? 'correct' : 'skipped'
      });

      room.gameState.currentWord = getRandomWord(room);
      broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('lastWordResult', ({ roomCode, isCorrect }) => {
    const room = rooms[roomCode];
    if (room && room.gameState.status === 'last_word') {
      touchRoom(roomCode);
      if (room.gameState.currentExplainerId !== socket.id) return;

      const team = room.teams.find(t => t.id === room.gameState.currentTeamId);
      if (isCorrect) team.score += 1;

      room.gameState.roundHistory.push({
        word: room.gameState.currentWord,
        status: isCorrect ? 'correct' : 'neutral' 
      });

      room.gameState.lastExplainerId = room.gameState.currentExplainerId;
      room.gameState.lastTeamId = room.gameState.currentTeamId;
      room.gameState.turnsTaken += 1;

      const maxTurns = room.settings.laps === 'infinity' ? Infinity : parseInt(room.settings.laps) * room.teams.length * 2;
      
      if (maxTurns !== Infinity && room.gameState.turnsTaken >= maxTurns) {
        room.gameState.status = 'game_over';
      } else {
        room.gameState.status = 'turn_ended';
        room.gameState.explainerIndices[team.id] = (room.gameState.explainerIndices[team.id] || 0) + 1;
        room.gameState.currentTeamIndex = (room.gameState.currentTeamIndex + 1) % room.teams.length;
      }
      
      room.gameState.pausedState = null; 
      broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('toggleWord', ({ roomCode, wordIndex }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player) return;
    
    if (room.hostId !== player.playerId && room.gameState.lastExplainerId !== socket.id) return;
    
    const historyItem = room.gameState.roundHistory[wordIndex];
    const team = room.teams.find(t => t.id === room.gameState.lastTeamId);
    
    if (historyItem && team) {
        if (historyItem.status === 'correct') {
            historyItem.status = 'neutral';
            team.score -= 1;
        } else if (historyItem.status === 'neutral') {
            historyItem.status = 'skipped';
            team.score -= 1;
        } else if (historyItem.status === 'skipped') {
            historyItem.status = 'correct';
            team.score += 2;
        }
        broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('endGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
      touchRoom(roomCode);
      if (room.timerInterval) clearInterval(room.timerInterval);
      room.gameState.status = 'lobby';
      room.gameState.pausedState = null; 
      broadcastRoomUpdate(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
