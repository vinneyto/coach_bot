# Coach bot (Bun + Telegram + Google Sheets + OpenAI)

Бот для ведения дел в Google Sheets:

- **tasks** (`A:B:C`): `A` краткое описание, `B` отметка (`✋` выполнено / `-` не выполнено), `C` детали (опционально)
- **process** (`A:B:C`): `A` кратко, `B` прогресс `0..100`, `C` детали (опционально)
- **plans** (`A`): заметки по одной строке

Бот работает в режиме **запрос → предпросмотр → подтверждение/отмена → запись в таблицу**.  
Поддерживает **текст** и **голос** (голос транскрибируется через OpenAI).

## Требования

- Google Spreadsheet с 3 листами: `tasks`, `process`, `plans`
- Доступ к таблице выдан **service account** (JSON ключ)
- Telegram Bot Token
- OpenAI API key

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

- **TELEGRAM_BOT_TOKEN**: токен Telegram бота
- **ALLOWED_USER_IDS**: список разрешённых пользователей (через запятую/пробел), минимум один id
- **OPENAI_API_KEY**: ключ OpenAI
- **OPENAI_MODEL**: модель чата (по умолчанию `gpt-4o-mini`)
- **OPENAI_TRANSCRIBE_MODEL**: модель для транскрипции (по умолчанию `gpt-4o-mini-transcribe`)
- **SPREADSHEET_ID**: id Google Spreadsheet
- **GOOGLE_CREDENTIALS_PATH** или **GOOGLE_CREDENTIALS_JSON**: service account credentials

Опционально:

- **SHEET_TASKS / SHEET_PROCESS / SHEET_PLANS**: названия листов
- **TASK_DONE_MARK / TASK_NOT_DONE_MARK**: символы для колонки `B` листа `tasks`

## Запуск локально (Bun)

```bash
bun install
cp .env.example .env
bun run src/index.ts
```

## Запуск в Docker

```bash
cp .env.example .env
docker build -t coach-bot .
docker run --rm --env-file .env \
  -v "$(pwd)/google-service-account.json:/run/secrets/google-service-account.json:ro" \
  coach-bot
```

Или через `docker-compose.yml` (см. комментарий про `volumes`).

## Как пользоваться

Примеры фраз (на русском):

- «добавь таск: оплатить хостинг»
- «закрой таск про хостинг»
- «процесс: релиз 1.2 — прогресс 40%»
- «обнови релиз до 60%»
- «план: в выходные разобрать бэклог»

Перед записью в таблицу бот всегда покажет, **как он понял запрос**, и попросит подтверждение.
