import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_USER_IDS: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default("gpt-4o-mini-transcribe"),

  SPREADSHEET_ID: z.string().min(1),
  GOOGLE_CREDENTIALS_PATH: z.string().min(1).optional(),
  GOOGLE_CREDENTIALS_JSON: z.string().min(1).optional(),

  SHEET_TASKS: z.string().min(1).default("tasks"),
  SHEET_PROCESS: z.string().min(1).default("process"),
  SHEET_PLANS: z.string().min(1).default("plans"),

  TASK_DONE_MARK: z.string().min(1).default("✋"),
  TASK_NOT_DONE_MARK: z.string().min(1).default("-"),

  LOG_LEVEL: z.string().min(1).default("info"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  allowedUserIds: Set<number>;
};

function parseAllowedUserIds(raw: string): Set<number> {
  const ids = raw
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));

  if (ids.length < 1) {
    throw new Error("ALLOWED_USER_IDS must contain at least one numeric id");
  }
  return new Set(ids);
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid env:\n${msg}`);
  }

  const cfg = parsed.data;
  if (!cfg.GOOGLE_CREDENTIALS_PATH && !cfg.GOOGLE_CREDENTIALS_JSON) {
    throw new Error("Provide GOOGLE_CREDENTIALS_PATH or GOOGLE_CREDENTIALS_JSON");
  }

  return {
    ...cfg,
    allowedUserIds: parseAllowedUserIds(cfg.ALLOWED_USER_IDS),
  };
}
