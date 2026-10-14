require('dotenv').config();
const { App } = require('@slack/bolt');

const REQUIRED_ENV_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'WP_ENDPOINT_URL',
  'WP_SECRET_KEY',
];

const missingEnvVars = REQUIRED_ENV_VARS.filter(
  (key) => !process.env[key] || process.env[key].trim() === ''
);

if (missingEnvVars.length > 0) {
  console.error('[Помилка конфігурації] Відсутні або порожні обов\'язкові змінні в .env:');
  missingEnvVars.forEach((key) => console.error(`  - ${key}`));
  console.error('\nЗаповніть їх у файлі slack-bot/.env перед запуском.');
  process.exit(1);
}

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN.trim();
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN.trim();
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET.trim();
const WP_ENDPOINT_URL = process.env.WP_ENDPOINT_URL.trim();
const WP_SECRET_KEY = process.env.WP_SECRET_KEY.trim();

const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function cleanSlackEmail(input) {
  if (!input) return '';
  const mailtoMatch = input.match(/<mailto:([^|>]+)(?:\|[^>]+)?>/i);
  if (mailtoMatch) {
    return mailtoMatch[1].trim();
  }
  return input.replace(/^<|>$/g, '').trim();
}

function cleanSlackUsername(input) {
  if (!input) return '';
  const mentionMatch = input.match(/<@[A-Z0-9]+\|([^>]+)>/i);
  if (mentionMatch) {
    return mentionMatch[1].trim();
  }
  return input.replace(/^@/, '').trim();
}

function unescapeSlackEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function formatWpError(status, data, username, email) {
  const code = data?.code || '';
  const message = data?.message || '';

  switch (code) {
    case 'username_exists':
      return `*Помилка: Користувач із таким логіном уже зареєстрований.*\nКористувач з логіном \`${username}\` вже присутній у базі WordPress. Будь ласка, вкажіть інший логін.`;

    case 'email_exists':
      return `*Помилка: Користувач із такою email-адресою уже зареєстрований.*\nАдреса \`${email}\` уже прив'язана до іншого облікового запису. Будь ласка, вкажіть інший email.`;

    case 'weak_password':
      return `*Помилка: Занадто простий або короткий пароль.*\nСервер WordPress вимагає пароль довжиною щонайменше 8 символів.`;

    case 'invalid_username':
      return `*Помилка: Некоректний логін користувача (username).*\n${message || 'Дозволені лише латинські літери, цифри, крапки, дефіси та підкреслення.'}`;

    case 'invalid_email':
      return `*Помилка: Некоректний формат email-адреси.*\n${message || 'Перевірте правильність введеної адреси електронної пошти.'}`;

    case 'missing_parameters':
      return `*Помилка: Відсутні обов'язкові параметри.*\n${message || 'Запит повинен містити логін, email та пароль.'}`;

    case 'unauthorized':
      return `*Помилка автентифікації (HTTP 401):*\nСекретний ключ бота не збігається зі значенням SLACK_BOT_SECRET_KEY на стороні WordPress.`;

    case 'server_misconfiguration':
      return `*Помилка сервера WordPress (HTTP 500):*\nКонстанта SLACK_BOT_SECRET_KEY не визначена у файлі wp-config.php.`;

    case 'creation_failed':
      return `*Помилка сервера WordPress (HTTP 500):*\nНе вдалося створити обліковий запис у системі через внутрішній збій.`;

    default:
      return `*Помилка сервера WordPress (HTTP ${status}):*\n${message || 'Сталася невідома помилка під час обробки запиту.'}`;
  }
}

const handleCreateUserCommand = async ({ command, ack, respond }) => {
  await ack();

  const rawArgs = (command.text || '').trim();
  const parts = rawArgs.split(/\s+/).filter(Boolean);

  if (parts.length < 3) {
    await respond({
      response_type: 'ephemeral',
      text:
        '*Помилка: Невірний формат команди.*\n\n' +
        'Необхідно вказати 3 обов\'язкові параметри через пробіл:\n' +
        '1. Логін (username)\n' +
        '2. Email\n' +
        '3. Пароль (мінімум 8 символів)\n\n' +
        '*Формат:* `/wp-create-user <username> <email> <password>`\n' +
        '*Приклад:* `/wp-create-user alex.admin alex@example.com StrongPassword2026!`',
    });
    return;
  }

  const username = cleanSlackUsername(parts[0]);
  const email = cleanSlackEmail(parts[1]);
  const password = unescapeSlackEntities(parts.slice(2).join(' '));

  if (!USERNAME_REGEX.test(username)) {
    await respond({
      response_type: 'ephemeral',
      text:
        '*Помилка: Некоректний логін користувача (username).*\n\n' +
        'Логін повинен містити лише:\n' +
        '• латинські літери (a-z, A-Z)\n' +
        '• цифри (0-9)\n' +
        '• крапку (.), дефіс (-) або підкреслення (_)\n\n' +
        `Введене значення: \`${username}\``,
    });
    return;
  }

  if (!EMAIL_REGEX.test(email)) {
    await respond({
      response_type: 'ephemeral',
      text:
        '*Помилка: Некоректний формат email-адреси.*\n\n' +
        'Будь ласка, вкажіть дійсну адресу електронної пошти.\n' +
        `Введене значення: \`${email}\``,
    });
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    await respond({
      response_type: 'ephemeral',
      text:
        '*Помилка: Занадто простий або короткий пароль.*\n\n' +
        `Довжина пароля має становити щонайменше ${MIN_PASSWORD_LENGTH} символів.\n` +
        `Поточна довжина введеного пароля: ${password.length} симв. Будь ласка, оберіть надійніший пароль.`,
    });
    return;
  }

  try {
    const response = await fetch(WP_ENDPOINT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WP_SECRET_KEY,
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await response.json().catch(() => null);

    if (response.status === 201) {
      const createdUser = data?.data || {};
      await respond({
        response_type: 'ephemeral',
        text:
          '*Користувача WordPress успішно створено.*\n\n' +
          `• ID: \`${createdUser.user_id ?? 'н/д'}\`\n` +
          `• Логін: \`${createdUser.username ?? username}\`\n` +
          `• Email: \`${createdUser.email ?? email}\`\n` +
          `• Роль: \`${createdUser.role ?? 'administrator'}\``,
      });

      console.log(`[Успіх] Створено користувача '${username}' (роль: administrator).`);
      return;
    }

    const errorMessage = formatWpError(response.status, data, username, email);
    await respond({
      response_type: 'ephemeral',
      text: errorMessage,
    });

    console.warn(
      `[Попередження] WordPress повернув статус ${response.status} для користувача '${username}'. Код помилки: ${data?.code || 'невідомий'}`
    );
  } catch (error) {
    console.error(
      `[Помилка з'єднання] Не вдалося звернутися до WordPress REST API (${WP_ENDPOINT_URL}):`,
      error.message
    );

    await respond({
      response_type: 'ephemeral',
      text:
        '*Помилка з\'єднання із сервером:*\n\n' +
        'Не вдалося встановити зв\'язок із сервером WordPress.\n' +
        'Перевірте, чи запущено сайт у Local WP та чи доступна адреса ' +
        `\`${WP_ENDPOINT_URL}\`.`,
    });
  }
};

app.command('/wp-create-user', handleCreateUserCommand);
app.command('/wp-user-create', handleCreateUserCommand);

(async () => {
  try {
    await app.start();
    console.log('Slack-бот запущений і підключений через Socket Mode.');
    console.log('Готовий приймати команди /wp-create-user та /wp-user-create.');
  } catch (error) {
    console.error('[Критична помилка запуску бота]:', error.message);
    process.exit(1);
  }
})();
