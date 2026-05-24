const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

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
  kickedPlayers: Array
}, { strict: false });

const RoomModel = mongoose.model('Room', roomSchema);

app.get('/ping', (req, res) => res.status(200).send('pong'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const verifyTwitchIdentity = async (token, claimedName) => {
    if (!token) return false;
    try {
        // Звертаємось до офіційного сервера авторизації Twitch
        const response = await fetch('https://id.twitch.tv/oauth2/validate', {
            headers: { 'Authorization': `OAuth ${token}` }
        });
        if (!response.ok) return false;
        const data = await response.json();
        // Твіч повертає логін. Перевіряємо, чи збігається він з іменем (без урахування регістру)
        return data.login.toLowerCase() === claimedName.toLowerCase();
    } catch (err) {
        console.error('Помилка валідації Твіч:', err);
        return false;
    }
};
// 🔥 РОЗДІЛЯЄМО ТАЙМАУТИ
const RAM_TIMEOUT = 2 * 60 * 60 * 1000;      // 2 години (для швидкої оперативної пам'яті)
const DB_TIMEOUT = 14 * 24 * 60 * 60 * 1000; // 14 днів (для бази даних)
const MAX_ROOMS = 100; 

// Завантаження кімнат при старті сервера
RoomModel.find({}).then(dbRooms => {
  const now = Date.now();
  dbRooms.forEach(r => {
    if (now - r.lastActive < DB_TIMEOUT) {
        // Якщо кімната ще свіжа (до 2 годин), вантажимо її в оперативку для гри
        if (now - r.lastActive < RAM_TIMEOUT) {
            const room = r.toObject();
            room.timerInterval = null;
            room.hostTimeoutObj = null;
            if (!room.gameState.fullHistory) room.gameState.fullHistory = []; 
            if (room.gameState.status === 'playing' || room.gameState.status === 'countdown') {
                room.gameState.status = 'paused';
                room.gameState.pausedState = 'active_turn';
            }
            rooms[r.id] = room;
        }
    } else {
        // Якщо кімнаті більше 2 тижнів - видаляємо назавжди
        RoomModel.deleteOne({ id: r.id }).catch(()=>({}));
    }
  });
  console.log(`📦 Відновлено активних кімнат: ${Object.keys(rooms).length}`);
});

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

const getSafeRoom = (room) => {
  const { timerInterval, hostTimeoutObj, ...safeRoom } = room;
  return safeRoom;
};

const broadcastRoomUpdate = (roomCode) => {
  const room = rooms[roomCode];
  if (!room) return;

  // Отримуємо безпечну версію без системних таймерів
  const safeRoom = getSafeRoom(room);
  
  // 1. Зберігаємо в базу даних повну версію (там слово має бути для історії)
  if (MONGO_URI) {
      RoomModel.findOneAndUpdate({ id: room.id }, safeRoom, { upsert: true }).catch(err => console.log('Помилка БД:', err));
  }

  // 2. Визначаємо, хто саме зараз пояснює слова
  let currentExplainerId = null;
  if (room.teams.length > 0 && room.gameState.currentTeamIndex < room.teams.length) {
      const activeTeam = room.teams[room.gameState.currentTeamIndex];
      const teamPlayers = room.players.filter(p => p.teamId === activeTeam?.id);
      if (teamPlayers.length > 0) {
          const explainerIndex = (room.gameState.explainerIndices[activeTeam.id] || 0) % teamPlayers.length;
          currentExplainerId = teamPlayers[explainerIndex]?.playerId;
      }
  }

  // 3. Відправляємо кожному гравцю ПЕРСОНАЛЬНУ копію даних
  room.players.forEach(player => {
      if (player.online && player.id) {
          // Робимо глибоку копію об'єкта, щоб зміна для одного не вплинула на інших
          const personalizedRoom = JSON.parse(JSON.stringify(safeRoom)); 

          // Якщо гра йде/на паузі, і цей гравець НЕ пояснюючий — ховаємо слово!
          if ((room.gameState.status === 'playing' || room.gameState.status === 'paused') && player.playerId !== currentExplainerId) {
              personalizedRoom.gameState.currentWord = "🔒 ПРИХОВАНО";
          }

          // Відправляємо дані точково на ID конкретного сокета (конкретній людині)
          io.to(player.id).emit('roomUpdated', personalizedRoom);
      }
  });
};

const touchRoom = (roomCode) => { if (rooms[roomCode]) rooms[roomCode].lastActive = Date.now(); };

// Періодичне очищення
setInterval(() => {
  const now = Date.now();
  
  // 1. Чистимо оперативку (якщо неактивні > 2 годин)
  for (const code in rooms) {
    if (now - rooms[code].lastActive > RAM_TIMEOUT) {
      delete rooms[code]; 
    }
  }

  // 2. Чистимо БД масово (якщо неактивні > 14 днів)
  if (MONGO_URI) {
      RoomModel.deleteMany({ lastActive: { $lt: now - DB_TIMEOUT } }).catch(()=>({}));
  }
}, 30 * 60 * 1000);

const dictionaries = {
  easy: "Яблуко Телевізор Кіт Стілець Молоко Поїзд Сонце Книга Машина Огірок Кросівки Телефон Море Літак Дерево Вікно Собака Двері Ручка Зошит Стіл Шафа Лампа Квітка Трава Небо Хмара Дощ Сніг Зима Літо Осінь Весна Річка Озеро Гора Ліс Птах Риба Хліб Масло Сир Ковбаса Чай Кава Вода Сік Цукор Сіль Перець Ложка Вилка Ніж Тарілка Чашка Каструля Сковорідка Диван Ліжко Подушка Ковдра Рушник Мило Шампунь Щітка Паста Дзеркало Гребінець Ножиці Папір Олівець Гумка Фарби Пензлик Клей Картон Пластилін Лялька М'яч Кубики Конструктор Велосипед Самокат Ролики Ковзани Лижі Санчата Рюкзак Сумка Гаманець Окуляри Годинник Капелюх Шапка Шарф Рукавиці Куртка Пальто Светр Футболка Майка Сорочка Штани Джинси Шорти Спідниця Сукня Шкарпетки Взуття Чоботи Туфлі Капці Брат Сестра Мама Тато Бабуся Дідусь Дядько Тітка Син Дочка Друг Сусід Вчитель Лікар Водій Продавець Кухар Перукар Будівельник Пожежник Поліцейський Художник Співак Актор Танцюрист Спортсмен Кіно Театр Цирк Музей Парк Зоопарк Лікарня Школа Садок Магазин Ринок Аптека Банк Пошта Ресторан Кафе Вокзал Аеропорт Завод Фабрика Місто Село Вулиця Площа Міст Дорога Світлофор Зупинка Кінотеатр Гітара Піаніно Скрипка Барабан Флейта Труба Баян Акордеон Мікрофон Навушники Камера Планшет Комп'ютер Мишка Клавіатура Монітор Принтер Роутер Флешка Батарейка Зарядка Дріт Розетка Вимикач Лампочка Свічка Сірники Запальничка Дрова Вугілля Вогонь Дим Попіл Пил Бруд Сміття Віник Швабра Відро Ганчірка Пилосос Праска Дошка Гвіздок Молоток Викрутка Кліщі Пилка Сокира Лопата Граблі Сапа Ліхтар Сходи Мотузка Нитки Голка Тканина Ґудзик Блискавка Кишеня Комір Рукав Капюшон Пояс Ремінь Каблучка Кольє Сережки Браслєт Корона Обличчя Око Ніс Вухо Губа Зуб Язик Волосся Голова Шия Плече Рука Спина Живіт Нога Коліно Ступня Палець Ніготь Шкіра Кров Серце Мозок Шлунок Печінка Нирка М'яз Кістка Суглоб Рана Шрам Ліки Пігулка Мазь Сироп Бинт Пластир Градусник Шприц Вата Спирт Йод Милиці Коляска Крісло Пуфик Табуретка Тумба Полиця Вішалка Килим Лінолеум Паркет Кахель Шпалери Фарба Цегла Цемент Бетон Пісок Глина Камінь Скло Метал Залізо Мідь Алюміній Золото Срібло Свинець Олово Пластмаса Гума Хутро Вовна Бавовна Шовк Льон Капрон Кавун Диня Яблуня Груша Слива Вишня Черешня Полуниця Суниця Малина Смородина Аґрус Морква Буряк Цибуля Часник Капуста Помідор Баклажан Кабачок Гарбуз Горох Квасоля Пшениця Жито Овес Кукурудза Соняшник Мак Троянда Тюльпан Ромашка Волошка Конвалія Бузок Дуб Береза Верба Клен Ясен Сосна Ялина Каштан Горобина Ведмідь Вовк Лисиця Заєць Білка Їжак Кабан Олень Лось Бобер Кріт Миша Щур Слон Жираф Зебра Тигр Лев Труси Панама Кепка Перстень Ланцюжок Сковорода Блюдце Келих Кухоль Таз Глечик Миска Простирадло Наволочка Мочалка Совок Пралка Холодильник Духовка Плита Мікрохвильовка Тостер Радіо Смартфон Ноутбук Компакт-диск Провід Трактор Мотоцикл Мопед Човен Корабель Пароплав Яхта Катер Вертоліт Ракета Електричка Трамвай Тролейбус Автобус Метро Такси Порт Гараж Парковка Траса Шосе Тунель Знак Перехрестя Пішохід Пасажир Квиток Паспорт Гроші Монета Банкнота Карта Рахунок Чек Квитанція Податок Ціна Знижка Здача Покупець Супермаркет Поліклініка Швидка Таблетка Мікстура Краплі Рецепт Медсестра Пацієнт Хвороба Здоров'я Біль Кашель Нежить Температура Діагноз Аналіз Слина Сльоза Піт Щіка Підборіддя Лоб Брова Вія".split(" "),
  medium: "Авангард Адекватність Ажіотаж Акваторія Акліматизація Алгоритм Альтернатива Амбіція Аналіз Аномалія Апетит Аристократ Арсенал Архітектура Асиметрія Асортимент Атмосфера Аудиторія Барикада Безмежність Біографія Блокнот Бульвар Вакансія Вакуум Вентиляція Вердикт Вертикаль Вібрація Візаж Вікторина Віртуальність Водоспад Габарит Галерея Гармонія Гастроном Генератор Генетика Гіпотеза Глобалізація Горизонт Гравітація Градація Грамота Декорація Делегат Демонстрація Депресія Десерт Дизайн Дилема Динаміка Дипломат Директор Дисципліна Діагноз Діалект Еволюція Екватор Екземпляр Екіпаж Економіка Екскурсія Експедиція Експеримент Експерт Еластичність Елемент Емоція Енергетика Ентузіазм Епідемія Епізод Ерудиція Естафета Етикет Ефект Ідеалізм Ілюзія Імунітет Інвалідність Інвентар Інвестиція Індивідуум Інженер Ініціатива Інновація Інстинкт Інтелект Інтервал Інтерв'ю Інтонація Інтуїція Іронія Кабінет Кандидат Капітал Карикатура Каталог Катастрофа Кваліфікація Кераміка Клімат Коаліція Колектив Комбінація Коментар Комерція Комітет Компанія Компенсація Комплекс Компроміс Конвеєр Конкурент Конспект Континент Контракт Контроль Конфлікт Концентрація Концепція Координата Коридор Корпорація Критерій Лабіринт Лабораторія Ландшафт Легенда Література Логіка Лояльність Магістраль Максимум Маніпуляція Марафон Маршрут Масштаб Матеріал Мелодія Менталітет Метафора Механізм Мінімум Моделювання Монолог Монумент Мотивація Музикант Навігація Натюрморт Неврастенія Нейтралітет Новатор Ностальгія Об'єктивність Облігація Оптимізм Орбіта Оригінал Орнамент Панорама Паралель Пасажир Патріот Пейзаж Периметр Персонаж Перспектива Песимізм Піраміда Планета Платформа Позиція Політика Полюс Потенціал Президент Премія Препарат Престиж Привілей Принцип Проблема Прогноз Програма Прогрес Проект Пропорція Професор Процес Психологія Публіка Радикал Радіус Реакція Реалізм Революція Регіон Регулятор Редактор Режисер Резерв Резолюція Результат Рекорд Ректор Релігія Репутація Ресурс Рефлекс Реформа Рецепт Ритміка Ритуал Рівновага Романтика Саботаж Санаторій Санкція Секретар Секунда Семінар Символ Симетрія Симптом Синтез Система Ситуація Скелет Скульптура Словник Солідарність Спектр Специфіка Спонсор Стабільність Стандарт Статистика Статус Стипендія Стратегія Структура Студент Суб'єктивність Суверенітет Сценарій Талант Темперамент Тенденція Теорема Терапія Територія Термін Технологія Тираж Товариш Традиція Траєкторія Трактор Транспорт Трансформація Тренінг Туризм Університет Фабрика Фактор Фантазія Факультет Фестиваль Фізика Філософія Фінанси Формула Фрагмент Фундамент Функція Характер Хімія Хірург Хроніка Художник Цензура Центр Цивілізація Чемпіон Шаблон Шедевр Шеренга Шрифт Штурман Екран Ювілей Юридичний Громадськість Суспільство Держава Уряд Парламент Закон Указ Постанова Рішення Наказ Розпорядження Договір Угода Документ Папір Бланк Заява Скарга Пропозиція Запит Відповідь Лист Повідомлення Інформація Новина Чутка Плітка Таємниця Секрет Загадка Відгадка Питання Задача Завдання Вправа Тест Іспит Залік Оцінка Бал Рейтинг Рівень Ступінь Звання Посада Професія Спеціальність Досвід Стаж Кар'єра Робота Праця Заробіток Зарплата Бонус Штраф Покарання Нагорода Приз Подарунок Сувенір Сюрприз Радість Смуток Горе Біда Нещастя Удача Успіх Перемога Поразка Нічия Змагання Турнір Чемпіонат Олімпіада Матч Гра Забава Розвага Відпочинок Сон Мрія Уява Пам'ять Думка Ідея Задум План Мета Ціль Дія Вчинок Поведінка Звичка Настрій Почуття Пристрасть Любов Кохання Дружба Ворожнеча Ненависть Злість Гнів Страх Жах Паніка Тривога Хвилювання Спокій Тиша Шум Звук Голос Крик Шепіт Спів Музика Ритм Темп Пісня Вірш Казка Басня Міф Історія Розповідь Роман Повість Оповідання Стаття Нарис Есе Журнал Газета Підручник Енциклопедія Довідник Інструкція Правило Норма Еталон Зразок Приклад Копія Підробка Фальшивка Обман Брехня Правда Істина Факт Доказ Аргумент Суперечка Дискусія Дебати Сварка Бійка Війна Мир Союз Альянс Організація Установа Підприємство Фірма Цех Майстерня Інститут Академія Коледж Ліцей Кафедра Відділ Сектор Група Клас Команда Загін Натовп Глядач Слухач Читач Письменник Поет Скульптор Композитор Продюсер Оператор Журналіст Репортер Ведучий Диктор Фотограф Модель Стиліст Візажист Косметолог Масажист Тренер Суддя Адвокат Прокурор Слідчий Охоронець Сторож Двірник Прибиральник Вантажник Кур'єр Листоноша Пілот Моряк Солдат Офіцер Генерал Міністр Депутат Мер Губернатор Посол Консул Шпигун Розвідник Агент".split(" "),
  hard: "Диверсифікація Екзистенціалізм Синхрофазотрон Метаморфоза Абстракція Інтроспекція Когнітивний Прокрастинація Конгруентність Асиміляція Фрустрація Парадокс Емансипація Трансцендентний Дезоксирибонуклеїнова Амплітуда Сингулярність Біфуркація Екстраполяція Детермінізм Редукціонізм Соліпсизм Епістемологія Онтологія Синергетика Ентропія Катарсис Емпатія Апатія Симбіоз Осмос Дифузія Резонанс Інтерференція Дифракція Дисперсія Поляризація Радіація Ізотоп Молекула Електрон Протон Нейтрон Кварк Бозон Глюон Фотон Нейтрино Мюон Тау-лептон Антиматерія Макроекономіка Мікроекономіка Інфляція Дефляція Стагфляція Девальвація Ревальвація Емісія Акція Дивіденд Ф'ючерс Опціон Хеджування Дефолт Банкрутство Монополія Олігополія Конкуренція Юриспруденція Прецедент Конституція Декларація Конвенція Ратифікація Денонсація Імпічмент Вето Кворум Консенсус Мораторій Ембарго Санкції Екстрадиція Апатрид Біпатрид Філантроп Мізантроп Альтруїст Егоїст Песиміст Оптиміст Скептик Цинік Нігіліст Агностик Атеїст Теїст Деїст Пантеїст Апологет Дисидент Ортодокс Єретик Маргінал Аутсайдер Істеблішмент Номенклатура Бюрократія Технократія Плутократія Охлократія Автократія Демократія Монархія Республіка Федерація Конфедерація Унітарізм Сепаратизм Іредентизм Анексія Окупація Капітуляція Контрибуція Репарація Демілітаризація Мобілізація Евакуація Депортація Репатріація Інтеграція Сегрегація Апартеїд Дискримінація Шовінізм Ксенофобія Мізогінія Фемінізм Патріархат Матріархат Полігамія Моногамія Ендогамія Екзогамія Інцест Непотизм Кронізм Корупція Хабарництво Здирництво Шантаж Рекетир Контрабанда Контрафакт Фальсифікація Плагіат Піратство Ліцензія Патент Копірайт Франшиза Дистриб'ютор Дилер Брокер Маклер Трейдер Інвестор Меценат Девелопер Провайдер Хостинг Домен Сервер Клієнт Трафік Роумінг Пінг Латентність Протокол Шифрування Криптографія Хеш Блокчейн Токен Майнінг Смарт-контракт Децентралізація Аутентифікація Авторизація Біометрія Сканер Радар Сонар Лазер Мазер Транзистор Діод Резистор Конденсатор Індуктивність Трансформатор Мотор Акумулятор Католізатор Електроліз Гальваніка Корозія Окислення Відновлення Полімеризація Випаровування Кипіння Плавлення Замерзання Делімітація Демаркація Апробація Епіфеномен Конфабуляція Транслітерація Гіпербола Літота Меридіан Паралакс Апогей Перигей Зеніт Надир Екліптика Азимут Прецесія Нутація Деривація Демарш Комюніке Верифікація Валідація Апроксимація Інтерполяція Регресія Коваріація Кореляція Пермутація Комбінаторика Топологія Гомоморфізм Ізоморфізм Ендоморфізм Автоморфізм Інволюція Ідемпотентність Нілапотентність Комутативність Асоціативність Дистрибутивність Транзитивність Еквівалентність Тавтологія Софізм Силогізм Ентимема Епіхейрема Полісилогізм Сорит Апорія Антиномія Дихотомія Тріада Тетрада Пентада Гексада Гептада Огдоада Еннеада Декада Гекзаметр Пентаметр Тетраметр Тріметр Диметр Монометр Анапест Амфібрахій Дактиль Хорей Ямб Спондей Пірихій Катрен Терцена Октава Сонет Тріолет Рондо Елегія Ода Гімн Дифірамб Панегірик Мадригал Епіграма Епітафія Пародія Памфлет Фейлетон Пасквіль Апокриф Палімпсест Інкунабула Фоліант Манускрипт Сувій Папірус Пергамент Велень Офорт Гравюра Літографія Ксилографія Ліногравюра Мецо-тинто Акватінта Суха-голка Резець Пунсон Шпіцштихель Фляшштихель Рулетка Гладилка Мастихін Палітра Мольберт Ескіз Накид Етюд Підмальовок Лесировка Імпасто Сфумато Кьяроскуро Тенебрізм Карнація Драперія Ракурс Світлотінь Блік Півтінь Тінь Контур Силует Фон Пропорція Метр Динаміка Статика Контраст Нюанс Колорит Гама Відтінок Колір Ахроматизм Хроматизм Насиченість Світлота Яскравість Контрастність Прозорість Глухість Пастозність Лесируваність Покривність Адгезія Когезія В'язкість Плинність Тиксотропія Синерезис Коагуляція Флокуляція Пептизація Желатинування Студніння Набухання Розчинення Аморфізація Десублімація Абревіатура Акронім Анаграма Паліндром Оксюморон Синекдоха Мезонімія".split(" "),
  gamer: "Рогалик Стім Рейд Хедшот Лут Геймпад Фпс Текстура Сейв Моб Крафт Манна Кулдаун Нерф Бафф Дебафф Агро Хіл Дпс Танк Саппорт Керрі Пуш Деф Фарм Грінд Дроп Спавн Респаун Квест Нпс Бос Мінібос Ачівка Скіл Перк Білд Стати Експа Левел Апгрейд Донат Мікротранзакція Лаг Фріз Глітч Баг Фікс Патч Мод Чіт Експлойт Спідран Стрім Каст Рендер Полігон Шейдер Асет Спрайт Піксель Воксель Аліасинг Інпут-лаг Тікрейт Хітбокс Хертбокс Фреймдата Фреймрейт Вісінк Скрін-тірінг Худ Юай Інвентар Лобі Матчмейкінг Ранк Ело Ммр Смурф Буст Токсик Тімейт Кемпер Рашер Снайпер Флангер Спліт-пуш Бекдор Ганг Роум Кайт Джук Бейт Зонінг Піл Ініціація Фокус Фокус-фаєр Бьорст Сустейн Клів Аое Дот Хот Сс Сайленс Стан Рут Слов Нокап Нокбек Блайнд Таунт Фір Чарм Інвул Імун Резіст Армор Хп Мп Стаміна Енергія Макро Мікро Апм Тілт Рейдж-квіт Гг Вп Ізі Катка Траймахард Казуал Хардкор Спідранер Датамайнер Лікер Анонс Трейлер Тизер Реліз Бета Альфа Ранній-доступ Длс Експаншн Спіноф Пріквел Сіквел Ремейк Ремастер Порт Емулятор Кросплей Кроссейв Хмарний-геймінг Віар Ейар Інді ААА БББ Шутер Платформер Рпг Жрпг Стелс Сурвайвал Хоррор Роуглайк Роуглайт Метроїдванія Файтинг Бітемап Спортивний-симулятор Рейсінг Стратегія Ртс Тбс Моба Авточесс Ккі Гача Візуальна-новела Поінт-енд-клік Пазл Ритм-гра Пісочниця Відкритий-світ Лінійний-сюжет Нелінійний-сюжет Квік-тайм-івент Катсцена Діалог Озвучка Саундтрек Емб'єнт Сфх Партикли Блум Моушн-блюр Антіаліасинг Рейтрейсінг Глобальне-освітлення Амбієнт-оклюжн Теселяція Лоди Міпмапи Анізотропна-фільтрація Трілінійна-фільтрація Білінійна-фільтрація Вертикальна-синхронізація Фрісінк Джісінк Герцівка Сенса Дпі Клава Механіка Мембранка Світчі Кейкапи Килимок Вебка Стік Трігер Бампер Хрестовина Вібровіддача Гіроскоп Аім-асист Командний-рядок Локал-хост Порт-форвардінг Нат Брандмауер Антивірус Впн Проксі Днс Айпі Мак-адреса Світч Хаб Кабель Кручена-пара Оптика Вайфай Блютуз Абілка Елітка Паті Гільдія Клан Ладдер Драфт Пік Бан Фаза Тік Вайтлист Блеклист Логаут Логін Пароль Акаунт Профіль Аватар Нікнейм Тайтл Жанр Сеттинг Лор Канон Філлер Брайтнес Хітмаркер Дамедж Хпс Ттк Фраг Асист Кда Стрік Ремпейдж Даблкілл Тріплкілл Квадракілл Пентакілл Ейс Клатч Комбек Флейм БМ Смурфінг Бустинг Деранк Мейн Вантрік Антимета Спліт Колл Шотколлер Ротація Позиціонка Спейсинг Пікінг Холдинг Пушинг Фрізинг Зонинг Кайтинг Джукинг Бейтинг Трейдинг Покінг Бьорстинг Сустейнинг Хілінг Шилдинг Баффінг Дебаффінг Клінзинг Пуржинг Інтерапт Станлок Чейнстан Дімінішинг Додж Парі Віфф Панніш Контерпік Контерплей Майндгейм Рендж Мілі Хітскан Проджектіл Сплеш Аутоатака Скілшот Таргет Нонтаргет Смарткаст Квіккаст Скріпт Хак Аімбот Волхак Есп Спіндбот Трігербот Макроси Бінди Конфіг Аліас Рейти Інтерп Лерп Чок Лосс Вар Спайк Краш Дисконнект Ролбек Вайп Чекпоінт Лоад Квіксейв Квіклоад Автосейв Хмарне-збереження Ачівмент Трофей Платина Комплішн Райдо Еніперсент Лоуперсент Глітчлесс Тас РТА ІГТ Сегментований Таймер Раутер Кліппінг Оуб Скіп Ворп Зіп Телепорт Дюп Геймбрейкер Софтлок Хардлок Дебюг Змінні Аргументи Параметри Флаги Опції Налаштування Пресети Віджет Панель Вікно Меню Кнопка Слайдер Чекбокс Радіобаттон Дропдаун Тултіп Попап Нотифікація Алерт Модалка Оверлей".split(" ")
};

io.on('connection', (socket) => {
  
  socket.on('createRoom', ({ playerName, playerId, isTwitchAuth }) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) return socket.emit('error', 'Сервери перевантажені!');
    const roomCode = generateRoomCode();
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
        timeLeft: 60, targetTime: 60, usedWords: [], roundHistory: [], fullHistory: [], turnsTaken: 0,
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
    
    const effectivePlayerId = isTwitchAuth ? `twitch_${playerName}` : playerId;

    if (room.kickedPlayers.includes(effectivePlayerId)) return socket.emit('error', 'Вас було виключено з цієї кімнати.');
    if (room.settings.requireTwitchAuth && !isTwitchAuth) return socket.emit('error', 'Хост увімкнув обов\'язковий вхід через Twitch!');
const existing = room.players.find(p => p.playerId === effectivePlayerId);

    if (existing) {
      if (existing.id && existing.id !== socket.id) {
          // Відправляємо старому сокету сигнал на відключення
          io.to(existing.id).emit('kicked_duplicate');
          
          // Примусово викидаємо старий сокет з кімнати на рівні сервера
          const oldSocket = io.sockets.sockets.get(existing.id);
          if (oldSocket) {
              oldSocket.leave(roomCode);
          }
      }

      existing.id = socket.id;
      existing.name = effectivePlayerName;
      existing.online = true;
      existing.isTwitch = isTwitchAuth || existing.isTwitch;
      
      if (room.gameState.currentExplainerId === oldId) room.gameState.currentExplainerId = socket.id;
      if (room.gameState.lastExplainerId === oldId) room.gameState.lastExplainerId = socket.id;

      if (room.hostId === effectivePlayerId && room.hostTimeoutObj) {
          clearTimeout(room.hostTimeoutObj);
          room.hostTimeoutObj = null;
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
    
    if (!room.hostId || !room.players.find(p => p.playerId === room.hostId && p.online)) room.hostId = effectivePlayerId;
    
    socket.join(roomCode);
    broadcastRoomUpdate(roomCode);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.online = false;
        
        const isExplainer = room.gameState.currentExplainerId === socket.id;
        const isGuesser = room.gameState.currentTeamId === player.teamId;
        
        if ((isExplainer || isGuesser) && ['playing', 'countdown'].includes(room.gameState.status)) {
            clearInterval(room.timerInterval);
            if (room.gameState.status !== 'countdown') room.gameState.targetTime = room.gameState.timeLeft;
            room.gameState.status = 'paused';
            room.gameState.autoPausedBySystem = true;
        }

        if (room.hostId === player.playerId) {
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
            io.to(targetPlayer.id).emit('kicked');
            const targetSocket = io.sockets.sockets.get(targetPlayer.id);
            if (targetSocket) targetSocket.leave(roomCode);
            broadcastRoomUpdate(roomCode);
        }
    }
  });
 // 🔥 НОВИЙ КОД: Передача прав хоста
  socket.on('transferHost', ({ roomCode, newHostId }) => {
    const room = rooms[roomCode];
    const host = room?.players.find(p => p.id === socket.id);
    
    // Перевіряємо, чи кімната існує і чи запит робить поточний хост
    if (room && host && room.hostId === host.playerId) {
        const targetPlayer = room.players.find(p => p.playerId === newHostId);
        
        // Якщо новий гравець знайдений, передаємо корону
        if (targetPlayer) {
            room.hostId = targetPlayer.playerId;
            
            // На всякий випадок чистимо таймер відключення старого хоста, якщо він був
            if (room.hostTimeoutObj) {
                clearTimeout(room.hostTimeoutObj);
                room.hostTimeoutObj = null;
            }
            
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

  // 🔥 НОВИЙ КОД: Обробка виходу з команди
  socket.on('leaveTeam', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room) {
      touchRoom(roomCode);
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.teamId = null; // Обнуляємо прив'язку гравця до команди
        broadcastRoomUpdate(roomCode);
      }
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
        room.gameState.roundHistory = [];
        room.gameState.fullHistory = []; // Очищуємо архів при скиданні
        room.gameState.pausedState = null;
        broadcastRoomUpdate(roomCode);
    }
  });

  const getRandomWord = (room) => {
    let pool = room.settings.dictType === 'custom' 
        ? (room.settings.customWords?.length > 0 ? room.settings.customWords : ["СЛОВНИК", "ПОРОЖНІЙ"])
        : (dictionaries[room.settings.dictType] || dictionaries.easy);
        
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

// ФУНКЦІЯ АРХІВУВАННЯ
  const saveTurnToHistory = (room) => {
      if ((room.gameState.status === 'turn_ended' || room.gameState.status === 'game_over') && room.gameState.roundHistory.length > 0 && room.gameState.lastTeamId) {
          
          // 🔥 ФІКС: Правильний розрахунок кола. 
          // Віднімаємо 1 від зіграних ходів, щоб точно знати, до якого кола належав щойно завершений хід
          const completedTurns = room.gameState.turnsTaken;
          const turnsPerLap = (room.teams.length || 1) * 2;
          const currentLap = Math.floor(Math.max(0, completedTurns - 1) / turnsPerLap) + 1;

          const explainer = room.players.find(p => p.id === room.gameState.lastExplainerId);
          
          const teamPlayers = room.players.filter(p => p.teamId === room.gameState.lastTeamId);
          const expIdx = teamPlayers.findIndex(p => p.id === room.gameState.lastExplainerId);
          const guesser = teamPlayers[(expIdx + 1) % (teamPlayers.length || 1)];

          room.gameState.fullHistory.push({
              teamId: room.gameState.lastTeamId,
              lap: currentLap,
              explainerName: explainer ? explainer.name : 'Гравець',
              guesserName: guesser ? guesser.name : 'Гравець',
              words: [...room.gameState.roundHistory]
          });
          room.gameState.roundHistory = []; 
      }
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

    // 🔥 НОВИЙ КОД: Перевірка кастомного словника
    if (room.settings.dictType === 'custom') {
        const customWords = room.settings.customWords || [];
        if (customWords.length < 50) {
            return socket.emit('error', `Для свого словника потрібно мінімум 50 слів! (Зараз: ${customWords.length})`);
        }
    }

    // 🔥 Зберігаємо попередній раунд в архів перед стартом нового!
    saveTurnToHistory(room);

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
        room.gameState.autoPausedBySystem = false; 
        broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('returnToLobby', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || (room.hostId !== player.playerId && room.gameState.currentExplainerId !== socket.id)) return;
    
    if (['playing', 'last_word', 'paused', 'countdown'].includes(room.gameState.status)) {
        clearInterval(room.timerInterval);
        if (room.gameState.status !== 'countdown' && room.gameState.status !== 'paused') room.gameState.targetTime = room.gameState.timeLeft;
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
      
      room.gameState.roundHistory.push({ word: room.gameState.currentWord, status: isCorrect ? 'correct' : 'skipped' });
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

      room.gameState.roundHistory.push({ word: room.gameState.currentWord, status: isCorrect ? 'correct' : 'neutral' });

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
        if (historyItem.status === 'correct') { historyItem.status = 'neutral'; team.score -= 1; }
        else if (historyItem.status === 'neutral') { historyItem.status = 'skipped'; team.score -= 1; }
        else if (historyItem.status === 'skipped') { historyItem.status = 'correct'; team.score += 2; }
        broadcastRoomUpdate(roomCode);
    }
  });

  socket.on('endGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (room && player && room.hostId === player.playerId) {
      touchRoom(roomCode);
      if (room.timerInterval) clearInterval(room.timerInterval);
      
      // 🔥 Зберігаємо архів перед виходом в лобі
      saveTurnToHistory(room);

      room.gameState.status = 'lobby';
      room.gameState.pausedState = null; 
      broadcastRoomUpdate(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
