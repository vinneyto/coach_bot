import type OpenAI from "openai";
import { z } from "zod";
import type { SheetsSnapshot } from "./sheets";

const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_task"),
    summary: z.string().min(1),
    payload: z.object({
      title: z.string().min(1),
      details: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal("close_task"),
    summary: z.string().min(1),
    payload: z.object({
      row: z.number().int().positive(),
      title: z.string().min(1),
    }),
  }),
  z.object({
    kind: z.literal("add_process"),
    summary: z.string().min(1),
    payload: z.object({
      title: z.string().min(1),
      percent: z.number().int().min(0).max(100),
      details: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal("update_process"),
    summary: z.string().min(1),
    payload: z.object({
      row: z.number().int().positive(),
      title: z.string().min(1),
      percent: z.number().int().min(0).max(100),
    }),
  }),
  z.object({
    kind: z.literal("add_plan"),
    summary: z.string().min(1),
    payload: z.object({
      text: z.string().min(1),
    }),
  }),
  z.object({
    kind: z.literal("noop"),
    summary: z.string().min(1),
    payload: z.object({}),
  }),
]);

export type CoachAction = z.infer<typeof actionSchema>;

function formatSnapshot(snapshot: SheetsSnapshot): string {
  const tasks = snapshot.tasks
    .slice(0, 200)
    .map(
      (t) =>
        `- row=${t.row} | ${t.done ? "✅" : "⬜"} ${t.title}${t.details ? ` — ${t.details}` : ""}`,
    )
    .join("\n");

  const processes = snapshot.processes
    .slice(0, 200)
    .map(
      (p) =>
        `- row=${p.row} | ${p.percent ?? "?"}% ${p.title}${p.details ? ` — ${p.details}` : ""}`,
    )
    .join("\n");

  const plans = snapshot.plans
    .slice(0, 200)
    .map((p) => `- row=${p.row} | ${p.text}`)
    .join("\n");

  return [
    "ТЕКУЩИЕ ДАННЫЕ ИЗ ТАБЛИЦЫ:",
    "",
    "TASKS:",
    tasks || "(пусто)",
    "",
    "PROCESS:",
    processes || "(пусто)",
    "",
    "PLANS:",
    plans || "(пусто)",
  ].join("\n");
}

function extractJson(text: string): unknown {
  // If model returns pure JSON - parse directly.
  try {
    return JSON.parse(text);
  } catch {
    // Otherwise try to find the first {...} block.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      return JSON.parse(slice);
    }
    throw new Error("No JSON found in model output");
  }
}

export async function interpret(
  client: OpenAI,
  model: string,
  userText: string,
  snapshot: SheetsSnapshot,
): Promise<CoachAction> {
  const system = [
    "Ты — Telegram-бот для ведения дел. Общение строго на русском.",
    "Ты НЕ ведешь диалог: по одному сообщению пользователя формируешь ОДНО действие.",
    "Нужно определить, что пользователь хочет сделать:",
    "- добавить task (tasks!A:C): A кратко, B отметка выполнения, C опционально детали",
    "- закрыть task (поставить отметку выполнения)",
    "- добавить process (process!A:C): A кратко, B процент 0..100, C опционально детали",
    "- обновить progress у process (изменить процент)",
    "- добавить plan (plans!A): одна строка заметки",
    "",
    "Важно:",
    "- Если закрываешь task или обновляешь process — выбери существующую строку по лучшему совпадению и верни точный row.",
    "- Процент всегда целое число 0..100.",
    "- Если запрос неясный — верни kind=noop и summary с просьбой переформулировать.",
    "",
    "Выводи ТОЛЬКО JSON без markdown и без пояснений.",
  ].join("\n");

  const snapshotText = formatSnapshot(snapshot);

  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${snapshotText}\n\nСООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n${userText}` },
    ],
  });

  const content = res.choices[0]?.message?.content ?? "";
  const json = extractJson(content);
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return {
      kind: "noop",
      summary: `Не смог корректно распознать действие. Переформулируйте, пожалуйста. (ошибка схемы: ${issues})`,
      payload: {},
    };
  }

  return parsed.data;
}
