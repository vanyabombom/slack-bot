# Інтеграція Slack-бота та WordPress REST API

Цей проєкт реалізує безпечну інтеграцію між Slack-ботом (Node.js / @slack/bolt) та WordPress (кастомний плагін з REST API эндпоінтом) для створення облікових записів користувачів із роллю administrator.

---

## Архітектура рішення

```
┌──────────────────────┐         Slash Command            ┌───────────────────────────┐
│  Користувач у Slack  │ ───────────────────────────────> │  Slack Bot (Node.js/Bolt) │
│                      │ <─────────────────────────────── │  (Socket Mode)            │
└──────────────────────┘   Відповідь (ephemeral)          └─────────────┬─────────────┘
                                                                        │
                                               POST /wp-json/slack-bot/v1/users
                                               Header: X-Webhook-Secret: <KEY>
                                               Body: { username, email, password }
                                                                        │
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │     WordPress Плагін      │
                                                          │   (slack-user-creator)    │
                                                          └─────────────┬─────────────┘
                                                                        │
                                                          wp_insert_user(..., 'administrator')
                                                                        │
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │      База даних WP        │
                                                          └───────────────────────────┘
```

### Основні переваги архітектури:
1. **Socket Mode у Slack:** Бот підключається до Slack через WebSocket. Немає необхідності прокидати білий IP, відкривати порти назовні або налаштовувати тунелі (ngrok).
2. **Безпека автентифікації:** Передача спільних секретів через заголовок `X-Webhook-Secret` та їх перевірка функцією `hash_equals()` у WordPress для унеможливлення Timing Attacks.
3. **Конфіденційність облікових даних:** Паролі та токени не потрапляють у логи консолі, повідомлення про помилки чи стек-трейси. Відповіді користувачу в Slack відправляються виключно в приватному режимі (`ephemeral`), щоб конфіденційні дані не залишалися в публічній історії каналу.

---

## Структура проєкту

```text
.
├── .gitignore
├── README.md
├── slack-bot/
│   ├── .env.example
│   ├── .env
│   ├── package.json
│   └── index.js
└── wp-plugin/
    └── slack-user-creator/
        └── slack-user-creator.php
```

---

## Інструкція зі встановлення та налаштування

### Крок 1. Налаштування плагіна у WordPress (Local WP)

1. **Скопіюйте файл плагіна:**
   Скопіюйте файл `wp-plugin/slack-user-creator/slack-user-creator.php` до директорії вашого сайту в Local WP:
   `app/public/wp-content/plugins/slack-user-creator.php`

2. **Активуйте плагін:**
   - Перейдіть у панель керування WordPress: **Плагіни -> Встановлені плагіни**.
   - Знайдіть **Slack User Creator Endpoint** та натисніть **Активувати**.

3. **Налаштуйте секретний ключ у `wp-config.php`:**
   Відкрийте файл `wp-config.php` у корені вашого WordPress-сайту та додайте наступний рядок перед блоком `/* That's all, stop editing! Happy publishing. */`:
   ```php
   define( 'SLACK_BOT_SECRET_KEY', '7b4e9f2a8c1d5e0f3b6a9c2d4e7f1a8b3c5d7e9f0a2b4c6d8e1f3a5b7c9d0e2f' );
   ```

---

### Крок 2. Налаштування Slack App

1. **Створення додатку:**
   - Перейдіть на https://api.slack.com/apps і натисніть **Create New App** -> **From scratch**.
   - Вкажіть ім'я та виберіть ваш робочий простір Slack.

2. **Увімкнення Socket Mode:**
   - У лівому меню виберіть розділ **Socket Mode**.
   - Перемкніть тумблер у положення **Enable Socket Mode**.
   - Створіть App-Level Token зі скоупом `connections:write`.
   - Скопіюйте отриманий токен (`xapp-...`) у змінну `SLACK_APP_TOKEN`.

3. **Налаштування прав доступу (Scopes):**
   - Перейдіть у розділ **OAuth & Permissions**.
   - У блоці **Bot Token Scopes** додайте скоуп `commands`.

4. **Встановлення додатку в Workspace:**
   - Натисніть **Install to Workspace** (або **Reinstall to Workspace**).
   - Скопіюйте **Bot User OAuth Token** (`xoxb-...`) у змінну `SLACK_BOT_TOKEN`.

5. **Отримання Signing Secret:**
   - Перейдіть у розділ **Basic Information** -> **App Credentials**.
   - Скопіюйте значення **Signing Secret** у змінну `SLACK_SIGNING_SECRET`.

6. **Створення Slash-команди:**
   - Перейдіть у розділ **Slash Commands** та натисніть **Create New Command**.
   - Параметри:
     - **Command:** `/wp-create-user`
     - **Short Description:** `Створення адміністратора WordPress`
     - **Usage Hint:** `<username> <email> <password>`
   - Збережіть зміни.

---

### Крок 3. Налаштування та запуск Slack-бота

1. **Перейдіть у папку бота:**
   ```bash
   cd slack-bot
   ```

2. **Заповніть файл `.env`:**
   ```env
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   SLACK_SIGNING_SECRET=...
   WP_ENDPOINT_URL=http://slack-bot.local/wp-json/slack-bot/v1/users
   WP_SECRET_KEY=7b4e9f2a8c1d5e0f3b6a9c2d4e7f1a8b3c5d7e9f0a2b4c6d8e1f3a5b7c9d0e2f
   ```

3. **Встановіть залежності:**
   ```bash
   npm install
   ```

4. **Запустіть бота:**
   - Для розробки з автоперезавантаженням:
     ```bash
     npm run dev
     ```
   - Або стандартний запуск:
     ```bash
     npm start
     ```

---

## Використання команди у Slack

У будь-якому каналі робочого простору виконайте команду:

```text
/wp-create-user alex.admin alex@example.com StrongPassword2026!
```

### Формат відповіді:
- **У разі успіху (HTTP 201):**
  > *Користувача WordPress успішно створено.*
  > • ID: `4`
  > • Логін: `alex.admin`
  > • Email: `alex@example.com`
  > • Роль: `administrator`

- **У разі занадто короткого пароля:**
  > *Помилка: Занадто простий або короткий пароль.*
  > Довжина пароля має становити щонайменше 8 символів.

- **У разі дубліката логіна (HTTP 409):**
  > *Помилка: Користувач із таким логіном уже зареєстрований.*
  > Користувач з логіном `alex.admin` вже присутній у базі WordPress. Будь ласка, вкажіть інший логін.

---

## Тестування REST API через cURL

### 1. Успішне створення користувача (HTTP 201 Created)
```bash
curl -X POST "http://slack-bot.local/wp-json/slack-bot/v1/users" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: 7b4e9f2a8c1d5e0f3b6a9c2d4e7f1a8b3c5d7e9f0a2b4c6d8e1f3a5b7c9d0e2f" \
  -d '{
    "username": "new_admin",
    "email": "new_admin@example.com",
    "password": "StrongPassword123!"
  }'
```

### 2. Спроба створення дубліката логіна (HTTP 409 Conflict)
```bash
curl -X POST "http://slack-bot.local/wp-json/slack-bot/v1/users" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: 7b4e9f2a8c1d5e0f3b6a9c2d4e7f1a8b3c5d7e9f0a2b4c6d8e1f3a5b7c9d0e2f" \
  -d '{
    "username": "new_admin",
    "email": "other_email@example.com",
    "password": "StrongPassword123!"
  }'
```

### 3. Невірний або відсутній секретний ключ (HTTP 401 Unauthorized)
```bash
curl -X POST "http://slack-bot.local/wp-json/slack-bot/v1/users" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: wrong_secret_key" \
  -d '{
    "username": "hacker",
    "email": "hacker@example.com",
    "password": "StrongPassword123!"
  }'
```

---

## Безпека

- **Захист від несанкціонованого доступу:** REST API доступний лише за наявності валідного `X-Webhook-Secret`.
- **Захист від витоку облікових даних:** Паролі користувачів ніколи не записуються в логи сервера і не передаються у відповідях API чи повідомленнях Slack.
- **Ефемерні повідомлення Slack:** Усі повідомлення від бота бачить лише той користувач, який відправив команду (`ephemeral`).
