const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const MAX_ROOMS = 100; 
const ROOM_TIMEOUT = 2 * 60 * 60 * 1000; 
const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    if (now - rooms[code].lastActive > ROOM_TIMEOUT) {
      delete rooms[code];
    }
  }
}, 30 * 60 * 1000);

const dictionaries = {
  easy: "Яблуко Телевізор Кіт Стілець Молоко Поїзд Сонце Книга Машина Огірок Кросівки Телефон Море Літак Дерево Вікно Собака Двері Ручка Зошит Стіл Шафа Лампа Квітка Трава Небо Хмара Дощ Сніг Зима Літо Осінь Весна Річка Озеро Гора Ліс Птах Риба Хліб Масло Сир Ковбаса Чай Кава Вода Сік Цукор Сіль Перець Ложка Вилка Ніж Тарілка Чашка Каструля Сковорідка Диван Ліжко Подушка Ковдра Рушник Мило Шампунь Щітка Паста Дзеркало Гребінець Ножиці Папір Олівець Гумка Фарби Пензлик Клей Картон Пластилін Лялька М'яч Кубики Конструктор Велосипед Самокат Ролики Ковзани Лижі Санчата Рюкзак Сумка Гаманець Окуляри Годинник Капелюх Шапка Шарф Рукавиці Куртка Пальто Светр Футболка Майка Сорочка Штани Джинси Шорти Спідниця Сукня Шкарпетки Взуття Чоботи Туфлі Капці Брат Сестра Мама Тато Бабуся Дідусь Дядько Тітка Син Дочка Друг Сусід Вчитель Лікар Водій Продавець Кухар Перукар Будівельник Пожежник Поліцейський Художник Співак Актор Танцюрист Спортсмен Кіно Театр Цирк Музей Парк Зоопарк Лікарня Школа Садок Магазин Ринок Аптека Банк Пошта Ресторан Кафе Вокзал Аеропорт Завод Фабрика Місто Село Вулиця Площа Міст Дорога Світлофор Зупинка Магазин Кінотеатр Гітара Піаніно Скрипка Барабан Флейта Труба Баян Акордеон Мікрофон Навушники Камера Планшет Комп'ютер Мишка Клавіатура Монітор Принтер Роутер Флешка Батарейка Зарядка Дріт Розетка Вимикач Лампочка Свічка Сірники Запальничка Дрова Вугілля Вогонь Дим Попіл Пил Бруд Сміття Віник Швабра Відро Ганчірка Пилосос Праска Дошка Гвіздок Молоток Викрутка Кліщі Пилка Сокира Лопата Граблі Сапа Ліхтар Сходи Мотузка Нитки Голка Ножиці Тканина Ґудзик Блискавка Кишеня Комір Рукав Капюшон Пояс Ремінь Каблучка Кольє Сережки Браслєт Корона Обличчя Око Ніс Вухо Губа Зуб Язик Волосся Голова Шия Плече Рука Спина Живіт Нога Коліно Ступня Палець Ніготь Шкіра Кров Серце Мозок Шлунок Печінка Нирка М'яз Кістка Суглоб Рана Шрам Ліки Пігулка Мазь Сироп Бинт Пластир Градусник Шприц Вата Спирт Йод Милиці Коляска Ліжко Диван Крісло Пуфик Стілець Табуретка Стіл Тумба Шафа Полиця Вішалка Дзеркало Килим Лінолеум Паркет Кахель Шпалери Фарба Клей Цегла Цемент Бетон Пісок Глина Камінь Скло Дерево Метал Залізо Мідь Алюміній Золото Срібло Свинець Олово Пластмаса Гума Картон Папір Плівка Тканина Шкіра Хутро Вовна Бавовна Шовк Льон Капрон".split(" "),
  medium: "Авангард Адекватність Ажіотаж Акваторія Акліматизація Алгоритм Альтернатива Амбіція Аналіз Аномалія Апетит Аристократ Арсенал Архітектура Асиметрія Асортимент Атмосфера Аудиторія Барикада Безмежність Біографія Блокнот Бульвар Вакансія Вакуум Вентиляція Вердикт Вертикаль Вібрація Візаж Вікторина Віртуальність Водоспад Габарит Галерея Гармонія Гастроном Генератор Генетика Гіпотеза Глобалізація Горизонт Гравітація Градація Грамота Декорація Делегат Демонстрація Депресія Десерт Дизайн Дилема Динаміка Дипломат Директор Дисципліна Діагноз Діалект Еволюція Екватор Екземпляр Екіпаж Економіка Екскурсія Експедиція Експеримент Експерт Еластичність Елемент Емоція Енергетика Ентузіазм Епідемія Епізод Ерудиція Естафета Етикет Ефект Ідеалізм Ілюзія Імунітет Інвалідність Інвентар Інвестиція Індивідуум Інженер Ініціатива Інновація Інстинкт Інтелект Інтервал Інтерв'ю Інтонація Інтуїція Іронія Кабінет Кандидат Капітал Карикатура Каталог Катастрофа Кваліфікація Кераміка Клімат Коаліція Колектив Комбінація Коментар Комерція Комітет Компанія Компенсація Комплекс Компроміс Конвеєр Конкурент Конспект Континент Контракт Контроль Конфлікт Концентрація Концепція Координата Коридор Корпорація Критерій Лабіринт Лабораторія Ландшафт Легенда Література Логіка Лояльність Магістраль Максимум Маніпуляція Марафон Маршрут Масштаб Матеріал Мелодія Менталітет Метафора Механізм Мінімум Моделювання Монолог Монумент Мотивація Музикант Навігація Натюрморт Неврастенія Нейтралітет Новатор Ностальгія Об'єктивність Облігація Оптимізм Орбіта Оригінал Орнамент Панорама Паралель Пасажир Патріот Пейзаж Периметр Персонаж Перспектива Песимізм Піраміда Планета Платформа Позиція Політика Полюс Потенціал Президент Премія Препарат Престиж Привілей Принцип Проблема Прогноз Програма Прогрес Проект Пропорція Професор Процес Психологія Публіка Радикал Радіус Реакція Реалізм Революція Регіон Регулятор Редактор Режисер Резерв Резолюція Результат Рекорд Ректор Релігія Репутація Ресурс Рефлекс Реформа Рецепт Ритміка Ритуал Рівновага Романтика Саботаж Санаторій Санкція Секретар Секунда Семінар Символ Симетрія Симптом Синтез Система Ситуація Скелет Скульптура Словник Солідарність Спектр Специфіка Спонсор Стабільність Стандарт Статистика Статус Стипендія Стратегія Структура Студент Суб'єктивність Суверенітет Сценарій Талант Темперамент Тенденція Теорема Терапія Територія Термін Технологія Тираж Товариш Традиція Траєкторія Трактор Транспорт Трансформація Тренінг Туризм Університет Фабрика Фактор Фантазія Факультет Фестиваль Фізика Філософія Фінанси Формула Фрагмент Фундамент Функція Характер Хімія Хірург Хроніка Художник Цензура Центр Цивілізація Чемпіон Шаблон Шедевр Шеренга Шрифт Штурман Екран Ювілей Юридичний".split(" "),
  hard: "Диверсифікація Екзистенціалізм Синхрофазотрон Метаморфоза Абстракція Інтроспекція Когнітивний Прокрастинація Конгруентність Асиміляція Фрустрація Парадокс Емансипація Трансцендентний Дезоксирибонуклеїнова Амплітуда Сингулярність Біфуркація Екстраполяція Детермінізм Редукціонізм Соліпсизм Епістемологія Онтологія Синергетика Ентропія Катарсис Емпатія Апатія Симбіоз Осмос Дифузія Резонанс Інтерференція Дифракція Дисперсія Поляризація Гравітація Радіація Ізотоп Молекула Електрон Протон Нейтрон Кварк Бозон Глюон Фотон Нейтрино Мюон Тау-лептон Антиматерія Макроекономіка Мікроекономіка Інфляція Дефляція Стагфляція Девальвація Ревальвація Емісія Облігація Акція Дивіденд Ф'ючерс Опціон Хеджування Дефолт Банкрутство Монополія Олігополія Конкуренція Юриспруденція Прецедент Конституція Декларація Конвенція Ратифікація Денонсація Імпічмент Вето Кворум Консенсус Мораторій Ембарго Санкції Екстрадиція Апатрид Біпатрид Філантроп Мізантроп Альтруїст Егоїст Песиміст Оптиміст Скептик Цинік Нігіліст Агностик Атеїст Теїст Деїст Пантеїст Апологет Дисидент Ортодокс Єретик Маргінал Аутсайдер Істеблішмент Номенклатура Бюрократія Технократія Плутократія Охлократія Автократія Демократія Монархія Республіка Федерація Конфедерація Унітарізм Сепаратизм Іредентизм Анексія Окупація Капітуляція Контрибуція Репарація Демілітаризація Мобілізація Евакуація Депортація Репатріація Асиміляція Інтеграція Сегрегація Апартеїд Дискримінація Шовінізм Ксенофобія Мізогінія Емансипація Фемінізм Патріархат Матріархат Полігамія Моногамія Ендогамія Екзогамія Інцест Непотизм Кронізм Корупція Хабарництво Здирництво Шантаж Рекетир Контрабанда Контрафакт Фальсифікація Плагіат Піратство Ліцензія Патент Копірайт Франшиза Дистриб'ютор Дилер Брокер Маклер Трейдер Інвестор Спонсор Меценат Девелопер Провайдер Хостинг Домен Сервер Клієнт Трафік Роумінг Пінг Латентність Протокол Шифрування Криптографія Хеш Блокчейн Токен Майнінг Смарт-контракт Децентралізація Аутентифікація Авторизація Біометрія Сканер Радар Сонар Лазер Мазер Транзистор Діод Резистор Конденсатор Індуктивність Трансформатор Генератор Мотор Акумулятор Католізатор Електроліз Гальваніка Корозія Окислення Відновлення Полімеризація Кристалізація Сублімація Конденсація Випаровування Кипіння Плавлення Замерзання Делімітація Демілітаризація Демаркація Апробація".split(" "),
  gamer: "Рогалик Стім Рейд Хедшот Лут Геймпад Фпс Текстура Сейв Моб Крафт Манна Кулдаун Нерф Бафф Дебафф Агро Хіл Дпс Танк Саппорт Керрі Пуш Деф Фарм Грінд Дроп Спавн Респаун Квест Нпс Бос Мінібос Ачівка Скіл Перк Білд Стати Експа Левел Апгрейд Донат Мікротранзакція Пінг Лаг Фріз Глітч Баг Фікс Патч Мод Чіт Експлойт Спідран Стрім Каст Рендер Полігон Шейдер Асет Спрайт Піксель Воксель Аліасинг Інпут-лаг Тікрейт Хітбокс Хертбокс Фреймдата Фреймрейт Вісінк Скрін-тірінг Худ Юай Інвентар Лобі Матчмейкінг Ранк Ело Ммр Смурф Буст Токсик Тімейт Кемпер Рашер Снайпер Флангер Спліт-пуш Бекдор Ганг Роум Кайт Джук Бейт Зонінг Піл Ініціація Фокус Фокус-фаєр Бьорст Сустейн Клів Аое Дот Хот Сс Сайленс Стан Рут Слов Нокап Нокбек Блайнд Таунт Фір Чарм Інвул Імун Резіст Армор Хп Мп Стаміна Енергія Ресурс Макро Мікро Апм Тілт Рейдж-квіт Гг Вп Ізі Катка Траймахард Казуал Хардкор Спідранер Датамайнер Лікер Анонс Трейлер Тизер Реліз Бета Альфа Ранній-доступ Длс Експаншн Спіноф Пріквел Сіквел Ремейк Ремастер Порт Емулятор Кросплей Кроссейв Хмарний-геймінг Віар Ейар Інді ААА БББ Шутер Платформер Рпг Жрпг Стелс Сурвайвал Хоррор Роуглайк Роуглайт Метроїдванія Файтинг Бітемап Спортивний-симулятор Рейсінг Стратегія Ртс Тбс Моба Авточесс Ккі Гача Візуальна-новела Квест Поінт-енд-клік Пазл Ритм-гра Пісочниця Відкритий-світ Лінійний-сюжет Нелінійний-сюжет Квік-тайм-івент Катсцена Діалог Озвучка Саундтрек Емб'єнт Сфх Партикли Блум Моушн-блюр Антіаліасинг Рейтрейсінг Глобальне-освітлення Амбієнт-оклюжн Теселяція Лоди Міпмапи Анізотропна-фільтрація Трілінійна-фільтрація Білінійна-фільтрація Вертикальна-синхронізація Фрісінк Джісінк Монітор Герцівка Мишка Сенса Дпі Клава Механіка Мембранка Світчі Кейкапи Килимок Навушники Мікрофон Вебка Геймпад Стік Трігер Бампер Хрестовина Вібровіддача Гіроскоп Аім-асист Макрос Бінди Консоль Термінал Командний-рядок Сервер Клієнт Хост Локал-хост Порт-форвардінг Нат Брандмауер Антивірус Впн Проксі Днс Айпі Мак-адреса Роутер Світч Хаб Кабель Кручена-пара Оптика Вайфай Блютуз".split(" ")
};

const getSafeRoom = (room) => {
  const { timerInterval, ...safeRoom } = room;
  return safeRoom;
};

const touchRoom = (roomCode) => {
  if (rooms[roomCode]) {
    rooms[roomCode].lastActive = Date.now();
  }
};

io.on('connection', (socket) => {
  
  socket.on('createRoom', ({ playerName, playerId }) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) {
      return socket.emit('error', 'Сервери перевантажені! Досягнуто ліміту кімнат. Спробуйте пізніше.');
    }

    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      id: roomCode,
      hostId: playerId, // ТЕПЕР ХОСТ ПРИВ'ЯЗАНИЙ ДО СТАБІЛЬНОГО ID
      lastActive: Date.now(),
      players: [{ id: socket.id, playerId, name: playerName, teamId: null, online: true }], // ДОДАНО ONLINE
      teams: [],
      settings: { timer: 60, dictType: 'medium', customWords: [] },
      gameState: { 
        status: 'lobby', 
        currentTeamIndex: 0, 
        explainerIndices: {}, 
        currentWord: '', 
        timeLeft: 60,
        usedWords: [], 
        roundHistory: [] 
      },
      timerInterval: null
    };
    socket.join(roomCode);
    socket.emit('roomCreated', getSafeRoom(rooms[roomCode]));
  });

  socket.on('joinRoom', ({ roomCode, playerName, playerId }) => {
    const room = rooms[roomCode];
    if (room) {
      touchRoom(roomCode);
      
      const existingPlayer = room.players.find(p => p.playerId === playerId);
      
      if (existingPlayer) {
        // Гравець перезайшов
        existingPlayer.id = socket.id;
        existingPlayer.name = playerName;
        existingPlayer.online = true; // Знову в мережі
      } else {
        // Абсолютно новий гравець
        room.players.push({ id: socket.id, playerId, name: playerName, teamId: null, online: true });
      }

      // Якщо хоста взагалі немає, або поточний хост оффлайн — передаємо корону
      if (!room.hostId || !room.players.find(p => p.playerId === room.hostId && p.online)) {
        room.hostId = playerId;
      }
      
      socket.join(roomCode);
      io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
    } else {
      socket.emit('error', 'Кімнату не знайдено або вона була видалена через неактивність.');
    }
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const player = room.players.find(p => p.id === socket.id);
      
      if (player) {
        player.online = false; // Позначаємо, що гравець відвалився
        
        // Якщо відвалився ХОСТ — намагаємося передати корону наступному ОНЛАЙН гравцю
        if (room.hostId === player.playerId) {
          const nextHost = room.players.find(p => p.playerId !== player.playerId && p.online);
          room.hostId = nextHost ? nextHost.playerId : null;
        }
        
        io.to(code).emit('roomUpdated', getSafeRoom(room));
        break;
      }
    }
  });

  socket.on('updateSettings', ({ roomCode, settings }) => {
    // Всюди, де потрібен захист хоста, тепер перевіряємо по playerId
    const player = rooms[roomCode]?.players.find(p => p.id === socket.id);
    if (rooms[roomCode] && player && rooms[roomCode].hostId === player.playerId) {
      touchRoom(roomCode);
      rooms[roomCode].settings = { ...rooms[roomCode].settings, ...settings };
      rooms[roomCode].gameState.usedWords = [];
      io.to(roomCode).emit('roomUpdated', getSafeRoom(rooms[roomCode]));
    }
  });

  socket.on('createTeam', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (room) {
      touchRoom(roomCode);
      const newTeam = { id: Date.now().toString(), name: teamName, score: 0 };
      room.teams.push(newTeam);
      room.gameState.explainerIndices[newTeam.id] = 0;
      io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
    }
  });

  socket.on('joinTeam', ({ roomCode, teamId }) => {
    const room = rooms[roomCode];
    if (room) {
      touchRoom(roomCode);
      const player = room.players.find(p => p.id === socket.id);
      const playersInTeam = room.players.filter(p => p.teamId === teamId);
      
      if (player && player.teamId !== teamId && playersInTeam.length >= 2) {
        return socket.emit('error', 'Команда вже заповнена (максимум 2 гравці)');
      }

      if (player) player.teamId = teamId;
      io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
    }
  });

  socket.on('deleteTeam', ({ roomCode, teamId }) => {
    const player = rooms[roomCode]?.players.find(p => p.id === socket.id);
    if (rooms[roomCode] && player && rooms[roomCode].hostId === player.playerId) {
      touchRoom(roomCode);
      rooms[roomCode].teams = rooms[roomCode].teams.filter(t => t.id !== teamId);
      rooms[roomCode].players.forEach(p => {
        if (p.teamId === teamId) p.teamId = null;
      });
      io.to(roomCode).emit('roomUpdated', getSafeRoom(rooms[roomCode]));
    }
  });

  const getRandomWord = (room) => {
    let pool = dictionaries[room.settings.dictType] || dictionaries.easy;
    if (room.settings.dictType === 'custom' && room.settings.customWords.length > 0) {
      pool = room.settings.customWords;
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

  socket.on('startTurn', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || room.hostId !== player.playerId) return;
    
    touchRoom(roomCode);

    if (room.teams.length === 0) return socket.emit('error', 'Створіть команди');
    for (const team of room.teams) {
      if (room.players.filter(p => p.teamId === team.id).length < 2) {
        return socket.emit('error', `У команді "${team.name}" треба мін. 2 гравці`);
      }
    }

    room.gameState.status = 'playing';
    room.gameState.timeLeft = room.settings.timer;
    room.gameState.roundHistory = []; 
    
    if (room.gameState.currentTeamIndex >= room.teams.length) {
      room.gameState.currentTeamIndex = 0;
    }
    
    const currentTeam = room.teams[room.gameState.currentTeamIndex];
    room.gameState.currentTeamId = currentTeam.id;

    const teamPlayers = room.players.filter(p => p.teamId === currentTeam.id);
    let expIdx = room.gameState.explainerIndices[currentTeam.id] || 0;
    if (expIdx >= teamPlayers.length) expIdx = 0;
    room.gameState.currentExplainerId = teamPlayers[expIdx].id; // ТУТ ЗАЛИШАЄМО socket.id, бо це для активного з'єднання

    room.gameState.currentWord = getRandomWord(room);
    io.to(roomCode).emit('roomUpdated', getSafeRoom(room));

    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      room.gameState.timeLeft -= 1;
      io.to(roomCode).emit('timerUpdate', room.gameState.timeLeft);
      if (room.gameState.timeLeft <= 0) {
        clearInterval(room.timerInterval);
        room.gameState.status = 'last_word';
        io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
      }
    }, 1000);
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
        isCorrect: isCorrect
      });

      room.gameState.currentWord = getRandomWord(room);
      io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
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
        isCorrect: isCorrect 
      });

      room.gameState.status = 'turn_ended';
      room.gameState.explainerIndices[team.id] = (room.gameState.explainerIndices[team.id] || 0) + 1;
      room.gameState.currentTeamIndex = (room.gameState.currentTeamIndex + 1) % room.teams.length;
      io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
    }
  });

  socket.on('endGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
      touchRoom(roomCode);
      if (room.timerInterval) clearInterval(room.timerInterval);
      room.gameState.status = 'lobby';
      io.to(roomCode).emit('roomUpdated', getSafeRoom(room));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server 3001`));
