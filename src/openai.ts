import OpenAI from "openai";
import type { AppConfig } from "./config";

export function createOpenAI(cfg: AppConfig): OpenAI {
  return new OpenAI({ apiKey: cfg.OPENAI_API_KEY });
}
