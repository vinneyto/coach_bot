import { google } from "googleapis";
import type { AppConfig } from "./config";

export type TaskItem = {
  row: number;
  title: string;
  done: boolean;
  details?: string;
};

export type ProcessItem = {
  row: number;
  title: string;
  percent: number | null;
  details?: string;
};

export type PlanItem = {
  row: number;
  text: string;
};

export type SheetsSnapshot = {
  tasks: TaskItem[];
  processes: ProcessItem[];
  plans: PlanItem[];
};

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function maybeDetails(v: unknown): string | undefined {
  const s = asString(v);
  return s.length ? s : undefined;
}

function maybeNumber(v: unknown): number | null {
  const s = asString(v);
  if (!s) return null;
  const n = Number(s.replace("%", "").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

async function loadCredentials(cfg: AppConfig): Promise<{
  client_email: string;
  private_key: string;
}> {
  if (cfg.GOOGLE_CREDENTIALS_JSON) {
    return JSON.parse(cfg.GOOGLE_CREDENTIALS_JSON) as { client_email: string; private_key: string };
  }
  if (!cfg.GOOGLE_CREDENTIALS_PATH) {
    throw new Error("Missing GOOGLE_CREDENTIALS_PATH");
  }
  const txt = await Bun.file(cfg.GOOGLE_CREDENTIALS_PATH).text();
  return JSON.parse(txt) as { client_email: string; private_key: string };
}

export class SheetsStore {
  private cfg: AppConfig;
  private sheets = google.sheets("v4");
  private auth!: InstanceType<typeof google.auth.JWT>;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
  }

  async init(): Promise<void> {
    const creds = await loadCredentials(this.cfg);
    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.auth = jwt;
  }

  async getSnapshot(): Promise<SheetsSnapshot> {
    const [tasksRaw, processRaw, plansRaw] = await Promise.all([
      this.sheets.spreadsheets.values.get({
        auth: this.auth,
        spreadsheetId: this.cfg.SPREADSHEET_ID,
        range: `${this.cfg.SHEET_TASKS}!A:C`,
      }),
      this.sheets.spreadsheets.values.get({
        auth: this.auth,
        spreadsheetId: this.cfg.SPREADSHEET_ID,
        range: `${this.cfg.SHEET_PROCESS}!A:C`,
      }),
      this.sheets.spreadsheets.values.get({
        auth: this.auth,
        spreadsheetId: this.cfg.SPREADSHEET_ID,
        range: `${this.cfg.SHEET_PLANS}!A:A`,
      }),
    ]);

    const tasksValues = tasksRaw.data.values ?? [];
    const processValues = processRaw.data.values ?? [];
    const plansValues = plansRaw.data.values ?? [];

    const tasks: TaskItem[] = tasksValues
      .map((row, idx) => {
        const title = asString(row?.[0]);
        const mark = asString(row?.[1]);
        const details = maybeDetails(row?.[2]);
        return {
          row: idx + 1,
          title,
          done: mark === this.cfg.TASK_DONE_MARK,
          details,
        };
      })
      .filter((t) => t.title.length > 0);

    const processes: ProcessItem[] = processValues
      .map((row, idx) => {
        const title = asString(row?.[0]);
        const percent = maybeNumber(row?.[1]);
        const details = maybeDetails(row?.[2]);
        return {
          row: idx + 1,
          title,
          percent,
          details,
        };
      })
      .filter((p) => p.title.length > 0);

    const plans: PlanItem[] = plansValues
      .map((row, idx) => {
        const text = asString(row?.[0]);
        return { row: idx + 1, text };
      })
      .filter((p) => p.text.length > 0);

    return { tasks, processes, plans };
  }

  async appendTask(title: string, details?: string): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      auth: this.auth,
      spreadsheetId: this.cfg.SPREADSHEET_ID,
      range: `${this.cfg.SHEET_TASKS}!A:C`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[title, this.cfg.TASK_NOT_DONE_MARK, details ?? ""]],
      },
    });
  }

  async closeTaskByRow(row: number): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      auth: this.auth,
      spreadsheetId: this.cfg.SPREADSHEET_ID,
      range: `${this.cfg.SHEET_TASKS}!B${row}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[this.cfg.TASK_DONE_MARK]],
      },
    });
  }

  async appendProcess(title: string, percent: number, details?: string): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      auth: this.auth,
      spreadsheetId: this.cfg.SPREADSHEET_ID,
      range: `${this.cfg.SHEET_PROCESS}!A:C`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[title, String(percent), details ?? ""]],
      },
    });
  }

  async updateProcessPercentByRow(row: number, percent: number): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      auth: this.auth,
      spreadsheetId: this.cfg.SPREADSHEET_ID,
      range: `${this.cfg.SHEET_PROCESS}!B${row}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[String(percent)]],
      },
    });
  }

  async appendPlan(text: string): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      auth: this.auth,
      spreadsheetId: this.cfg.SPREADSHEET_ID,
      range: `${this.cfg.SHEET_PLANS}!A:A`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[text]],
      },
    });
  }
}
