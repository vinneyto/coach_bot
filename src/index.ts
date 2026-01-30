import "dotenv/config";
import { Bot, type Context, InlineKeyboard } from "grammy";
import { loadConfig } from "./config";
import { type CoachAction, interpret } from "./llm";
import { createOpenAI } from "./openai";
import { SheetsStore } from "./sheets";
import { transcribeTelegramVoice } from "./transcribe";

type Pending = {
  id: string;
  action: CoachAction;
  originalText: string;
  createdAt: number;
};

function randomId(): string {
  return crypto.randomUUID();
}

function pendingKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

function isAllowed(cfg: ReturnType<typeof loadConfig>, userId: number | undefined): boolean {
  if (!userId) return false;
  return cfg.allowedUserIds.has(userId);
}

async function executeAction(store: SheetsStore, action: CoachAction): Promise<string> {
  switch (action.kind) {
    case "add_task": {
      await store.appendTask(action.payload.title, action.payload.details);
      return `Ок, добавил task: «${action.payload.title}».`;
    }
    case "close_task": {
      const snap = await store.getSnapshot();
      const found = snap.tasks.find((t) => t.row === action.payload.row);
      if (!found) {
        return `Не нашёл task в строке ${action.payload.row}. Возможно таблица изменилась — отправьте запрос ещё раз.`;
      }
      await store.closeTaskByRow(action.payload.row);
      return `Ок, закрыл task (row=${action.payload.row}): «${found.title}».`;
    }
    case "add_process": {
      await store.appendProcess(
        action.payload.title,
        action.payload.percent,
        action.payload.details,
      );
      return `Ок, добавил process: «${action.payload.title}» (${action.payload.percent}%).`;
    }
    case "update_process": {
      const snap = await store.getSnapshot();
      const found = snap.processes.find((p) => p.row === action.payload.row);
      if (!found) {
        return `Не нашёл process в строке ${action.payload.row}. Возможно таблица изменилась — отправьте запрос ещё раз.`;
      }
      await store.updateProcessPercentByRow(action.payload.row, action.payload.percent);
      return `Ок, обновил progress (row=${action.payload.row}): «${found.title}» → ${action.payload.percent}%.`;
    }
    case "add_plan": {
      await store.appendPlan(action.payload.text);
      return `Ок, добавил plan: «${action.payload.text}».`;
    }
    case "noop": {
      return action.summary;
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const openai = createOpenAI(cfg);

  const store = new SheetsStore(cfg);
  await store.init();

  const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
  const pending = new Map<string, Pending>();

  bot.command("start", async (ctx) => {
    if (!isAllowed(cfg, ctx.from?.id)) return ctx.reply("Нет доступа.");
    await ctx.reply(
      [
        "Привет! Я бот для ведения tasks/process/plans в Google Sheets.",
        "Отправь текст или голос — я предложу действие и попрошу подтверждение.",
        "",
        "Примеры:",
        "- «добавь таск: оплатить хостинг»",
        "- «закрой таск про хостинг»",
        "- «процесс: релиз 1.2 — прогресс 40%»",
        "- «обнови релиз до 60%»",
        "- «план: в выходные разобрать бэклог»",
      ].join("\n"),
    );
  });

  bot.on("callback_query:data", async (ctx) => {
    if (!isAllowed(cfg, ctx.from?.id)) {
      await ctx.answerCallbackQuery({ text: "Нет доступа." });
      return;
    }

    const data = ctx.callbackQuery.data ?? "";
    const m = /^(confirm|cancel):(.+)$/.exec(data);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }

    const op = m[1];
    const id = m[2];

    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (!chatId || !userId) {
      await ctx.answerCallbackQuery();
      return;
    }

    const key = pendingKey(chatId, userId);
    const item = pending.get(key);
    if (!item || item.id !== id) {
      await ctx.answerCallbackQuery({ text: "Это подтверждение уже неактуально." });
      return;
    }

    if (op === "cancel") {
      pending.delete(key);
      await ctx.answerCallbackQuery({ text: "Отменено" });
      await ctx.reply("Ок, отменил. Можете отправить исправленный текст.");
      return;
    }

    pending.delete(key);
    await ctx.answerCallbackQuery({ text: "Принято" });
    try {
      const result = await executeAction(store, item.action);
      await ctx.reply(result);
    } catch (e) {
      await ctx.reply(
        `Ошибка при обновлении таблицы: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  async function handleUserText(ctx: Context, text: string): Promise<void> {
    const userId = ctx.from?.id as number | undefined;
    const chatId = ctx.chat?.id as number | undefined;
    if (!isAllowed(cfg, userId)) {
      await ctx.reply("Нет доступа.");
      return;
    }
    if (!chatId || !userId) return;

    const key = pendingKey(chatId, userId);
    if (pending.has(key)) {
      await ctx.reply("Сначала подтвердите/отмените предыдущее действие кнопками.");
      return;
    }

    const snapshot = await store.getSnapshot();
    const action = await interpret(openai, cfg.OPENAI_MODEL, text, snapshot);

    if (action.kind === "noop") {
      await ctx.reply(action.summary);
      return;
    }

    const id = randomId();
    pending.set(key, { id, action, originalText: text, createdAt: Date.now() });

    const kb = new InlineKeyboard()
      .text("Подтвердить", `confirm:${id}`)
      .text("Отмена", `cancel:${id}`);

    await ctx.reply(`Я понял так:\n\n${action.summary}\n\nПодтвердить?`, { reply_markup: kb });
  }

  bot.on("message:text", async (ctx) => {
    const text = (ctx.message.text ?? "").trim();
    if (!text) return;
    await handleUserText(ctx, text);
  });

  bot.on("message:voice", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(cfg, userId)) {
      await ctx.reply("Нет доступа.");
      return;
    }

    try {
      const file = await ctx.getFile();
      if (!file.file_path) {
        await ctx.reply("Не удалось получить голосовое сообщение.");
        return;
      }
      const url = `https://api.telegram.org/file/bot${cfg.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const text = await transcribeTelegramVoice(openai, cfg.OPENAI_TRANSCRIBE_MODEL, url);
      if (!text) {
        await ctx.reply("Не смог распознать голос. Попробуйте ещё раз или отправьте текстом.");
        return;
      }
      await ctx.reply(`Распознал так:\n\n${text}`);
      await handleUserText(ctx, text);
    } catch (e) {
      await ctx.reply(
        `Ошибка при обработке голосового: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  bot.catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Bot error:", err.error);
  });

  // Polling
  await bot.start({
    drop_pending_updates: true,
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
