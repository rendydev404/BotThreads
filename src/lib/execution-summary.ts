/**
 * Ringkasan hasil eksekusi rencana aksi otomatis (murni, tanpa I/O).
 *
 * Fakta (siapa, kapan tayang, isi, gagal atau berhasil) disusun deterministik dari hasil nyata
 * orkestrator, jadi tidak ada angka atau jam karangan. AI hanya menulis penutupnya (lihat
 * action-plan-chat.ts), dan bila penutup AI memuat angka di luar fakta, dipakai penutup cadangan.
 */
import { formatWibFull } from "./scheduling";

export type ExecutionPublish = "schedule" | "now" | "draft";
export type ExecutionStatus = "SCHEDULED" | "FAILED" | "DRAFT" | "SKIPPED";

export interface ExecutionAccount {
  username: string;
  status: ExecutionStatus;
  /** Jam tayang (ISO UTC) bila sudah masuk antrean. */
  at: string | null;
  text: string;
  error: string | null;
  /** Jam digeser sistem karena bentrok dengan postingan lain. */
  moved: boolean;
}

export interface ExecutionTask {
  title: string;
  topic: string;
  accounts: ExecutionAccount[];
}

export interface Execution {
  publish: ExecutionPublish;
  tasks: ExecutionTask[];
}

const MAX_TASKS = 3;
const MAX_ACCOUNTS = 40;
const SHOWN_ROWS = 12;

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Validasi payload dari klien; null bila bentuknya tidak dikenali atau tidak ada hasil. */
export function parseExecution(raw: unknown): Execution | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { publish?: unknown; tasks?: unknown };
  const publish: ExecutionPublish = r.publish === "now" || r.publish === "draft" ? r.publish : "schedule";
  if (!Array.isArray(r.tasks)) return null;

  const tasks: ExecutionTask[] = [];
  for (const t of r.tasks.slice(0, MAX_TASKS)) {
    if (!t || typeof t !== "object") continue;
    const task = t as { title?: unknown; topic?: unknown; accounts?: unknown };
    const accounts: ExecutionAccount[] = [];
    for (const a of (Array.isArray(task.accounts) ? task.accounts : []).slice(0, MAX_ACCOUNTS)) {
      if (!a || typeof a !== "object") continue;
      const acc = a as Record<string, unknown>;
      const username = str(acc.username, 60).replace(/^@/, "");
      if (!username) continue;
      const status: ExecutionStatus =
        acc.status === "SCHEDULED" || acc.status === "FAILED" || acc.status === "DRAFT" ? acc.status : "SKIPPED";
      const at = typeof acc.at === "string" && Number.isFinite(Date.parse(acc.at)) ? new Date(acc.at).toISOString() : null;
      accounts.push({
        username,
        status,
        at,
        text: str(acc.text, 600),
        error: str(acc.error, 200) || null,
        moved: acc.moved === true,
      });
    }
    const title = str(task.title, 70);
    if (title) tasks.push({ title, topic: str(task.topic, 300), accounts });
  }
  return tasks.length > 0 ? { publish, tasks } : null;
}

export interface ExecutionCounts {
  scheduled: number;
  failed: number;
  skipped: number;
  drafts: number;
}

export function countExecution(e: Execution): ExecutionCounts {
  const c: ExecutionCounts = { scheduled: 0, failed: 0, skipped: 0, drafts: 0 };
  for (const t of e.tasks) {
    for (const a of t.accounts) {
      if (a.status === "SCHEDULED") c.scheduled++;
      else if (a.status === "FAILED") c.failed++;
      else if (a.status === "DRAFT") c.drafts++;
      else c.skipped++;
    }
  }
  return c;
}

const MODE_LABEL: Record<ExecutionPublish, string> = {
  schedule: "Dijadwalkan di jam ramai",
  now: "Diposting sekarang",
  draft: "Draf untuk ditinjau",
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const snippet = (s: string, n: number) => {
  const t = s.replace(/`/g, "'").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function statusLabel(a: ExecutionAccount, publish: ExecutionPublish): string {
  switch (a.status) {
    case "SCHEDULED":
      return `${publish === "now" ? "Antre terbit" : "Terjadwal"}${a.moved ? " (digeser)" : ""}`;
    case "FAILED":
      return "Gagal";
    case "DRAFT":
      return "Draf";
    default:
      return "Dilewati";
  }
}

/** Ringkasan Markdown (judul, stat, tabel per tugas) dari hasil nyata. */
export function executionMarkdown(e: Execution): string {
  const c = countExecution(e);
  const noResult = c.scheduled === 0 && c.drafts === 0;
  const out: string[] = [];

  out.push(
    noResult
      ? "## Eksekusi selesai, tetapi belum ada yang masuk antrean"
      : `## Selesai: ${e.tasks.length} tugas dikerjakan otomatis`
  );

  const stat: string[] = [];
  if (e.publish === "draft") stat.push(`Draf dibuat | ${c.drafts} | siap ditinjau`);
  else stat.push(`Masuk antrean | ${c.scheduled} | ${MODE_LABEL[e.publish]}`);
  stat.push(`Gagal | ${c.failed}`);
  if (c.skipped > 0) stat.push(`Dilewati | ${c.skipped} | akun belum siap`);
  stat.push(`Tugas | ${e.tasks.length}`);
  out.push("```stat\n" + stat.join("\n") + "\n```");

  e.tasks.forEach((t, i) => {
    out.push(`### ${i + 1}. ${t.title}`);
    if (t.accounts.length === 0) {
      out.push("Tidak ada akun yang menghasilkan posting untuk tugas ini.");
      return;
    }
    const rows = t.accounts.slice(0, SHOWN_ROWS).map((a) => {
      const when = a.at ? formatWibFull(new Date(a.at)) : "-";
      const body = a.status === "FAILED" || a.status === "SKIPPED" ? a.error ?? "-" : `"${snippet(a.text, 80)}"`;
      return `| @${cell(a.username)} | ${statusLabel(a, e.publish)} | ${when} | ${cell(body)} |`;
    });
    const more = t.accounts.length - SHOWN_ROWS;
    out.push(["| Akun | Status | Tayang | Isi singkat |", "| --- | --- | --- | --- |", ...rows].join("\n"));
    if (more > 0) out.push(`…dan ${more} akun lainnya dengan hasil serupa.`);
  });

  return out.join("\n\n");
}

/** Fakta ringkas untuk penulis penutup (satu baris per akun). */
export function executionFacts(e: Execution): string {
  const c = countExecution(e);
  const lines = [
    `Mode: ${MODE_LABEL[e.publish]}`,
    `Hasil: ${c.scheduled} masuk antrean, ${c.failed} gagal, ${c.skipped} dilewati, ${c.drafts} draf, dari ${e.tasks.length} tugas.`,
  ];
  e.tasks.forEach((t, i) => {
    lines.push(`Tugas ${i + 1}: ${t.title} (arahan: ${snippet(t.topic, 160)})`);
    for (const a of t.accounts.slice(0, SHOWN_ROWS)) {
      lines.push(
        `- @${a.username}: ${statusLabel(a, e.publish)}${a.at ? `, tayang ${formatWibFull(new Date(a.at))}` : ""}${a.error ? `, alasan: ${a.error}` : ""}`
      );
    }
  });
  return lines.join("\n");
}

/** Penutup cadangan bila AI tidak tersedia atau penutupnya memuat angka di luar fakta. */
export function fallbackClosing(e: Execution): string {
  const c = countExecution(e);
  const parts: string[] = [];
  if (c.scheduled > 0) {
    parts.push(
      e.publish === "now"
        ? `${c.scheduled} posting sudah masuk antrean terbit dan akan tayang dalam beberapa menit.`
        : `${c.scheduled} posting sudah terjadwal di jam ramai masing-masing akun.`
    );
    parts.push("Cek views dan interaksinya sekitar 24 jam setelah tayang, lalu minta saya membandingkannya dengan rata-rata akun.");
  } else if (c.drafts > 0) {
    parts.push("Drafnya siap Anda tinjau sebelum dijadwalkan.");
  }
  if (c.failed > 0) parts.push(`${c.failed} akun gagal; buka kartu tugasnya untuk mencoba lagi atau minta saya membuat ulang.`);
  if (c.skipped > 0) parts.push(`${c.skipped} akun dilewati karena belum siap diposting.`);
  if (parts.length === 0) parts.push("Belum ada posting yang masuk antrean. Coba jalankan ulang rencananya.");
  return parts.join(" ");
}

/** Gabungkan fakta dan penutup menjadi satu pesan chat. */
export function composeExecutionMessage(e: Execution, closing: string): string {
  const quote = closing
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `${executionMarkdown(e)}\n\n> [!TIP] Penutup\n${quote}`;
}
