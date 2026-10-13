import { generateWithFailover } from "./gemini";
import { isPublishEnabled } from "./content-config";
import { listPublishAccounts } from "./publish-accounts";
import { PLAN_SCHEMA, PLAN_SYSTEM, normalizePlan, type ActionPlan } from "./action-plan";
import { checkAnswer, numberPool } from "./answer-check";
import {
  composeExecutionMessage,
  executionFacts,
  fallbackClosing,
  type Execution,
} from "./execution-summary";

export interface PlanReply {
  message: string;
  plan?: ActionPlan;
  model: string | null;
  degraded: boolean;
}

const NONE = (message: string, degraded = false): PlanReply => ({ message, model: null, degraded });

/**
 * Ubah saran asisten menjadi rencana aksi yang bisa dikerjakan orkestrator. Tidak menulis apa pun:
 * hanya menyusun rencana; eksekusi terjadi setelah pengguna memilih waktu posting di kartu.
 */
export async function buildPlanReply(opts: { advice: string; userText: string }): Promise<PlanReply> {
  if (!opts.advice.trim()) {
    return NONE("Belum ada saran yang bisa dikerjakan. Tanyakan analisis dulu, misalnya \"Apa langkah konkret minggu depan?\", lalu minta saya mengerjakannya.");
  }

  const ready = (await listPublishAccounts()).filter((a) => a.ready);
  if (ready.length === 0) {
    return NONE("Belum ada akun yang siap diposting. Pastikan akun cabang sudah dipetakan dan terhubung di SukaPost.");
  }

  const list = ready
    .slice(0, 60)
    .map((a) => `@${a.username ?? a.displayName} (${a.displayName})`)
    .join("\n");
  const result = await generateWithFailover({
    system: PLAN_SYSTEM,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `DAFTAR AKUN (siap diposting):\n${list}\n\nSARAN ASISTEN:\n${opts.advice}\n\nPERMINTAAN PENGGUNA: ${opts.userText}`,
          },
        ],
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 1500,
    timeoutMs: 40_000,
    deadlineMs: 45_000,
    responseSchema: PLAN_SCHEMA,
    validate: (j) => !!j && typeof j === "object" && Array.isArray((j as { tasks?: unknown }).tasks),
  });
  if (!result) return NONE("AI sedang tidak tersedia, jadi rencana belum bisa disusun. Coba lagi sebentar lagi.", true);

  const { tasks, notExecutable } = normalizePlan(
    result.json,
    ready.map((a) => ({ id: a.id, username: a.username, displayName: a.displayName }))
  );
  if (tasks.length === 0) {
    return {
      message: `Saran tadi belum bisa saya kerjakan otomatis${notExecutable ? `: ${notExecutable}` : ", karena bukan tindakan posting konten"}. Saya hanya bisa menulis dan memposting konten; minta saya \"buat 3 draf\" bila ingin konten dari temuan tadi.`,
      model: result.model,
      degraded: false,
    };
  }

  const publishEnabled = isPublishEnabled();
  return {
    message: `Saya susun **${tasks.length} tugas** dari saran tadi. Pilih waktu posting di bawah; sisanya saya kerjakan otomatis tanpa bertanya lagi.${publishEnabled ? "" : " Catatan: posting otomatis sedang dimatikan, jadi hasilnya berupa draf untuk ditinjau."}`,
    plan: { tasks, readyCount: ready.length, publishEnabled },
    model: result.model,
    degraded: false,
  };
}

const CLOSING_SYSTEM = `Anda menutup eksekusi otomatis di dashboard Threads Suka Shawarma. Tulis PENUTUP dalam bahasa Indonesia yang hangat dan ringkas, 2 sampai 4 kalimat, tanpa judul, tanpa tabel, tanpa emoji.

Isi penutup:
- Satu kalimat yang menyimpulkan apa yang baru saja dikerjakan secara umum (jangan mengulang tabel akun satu per satu).
- Satu hal yang layak dipantau berikutnya, sesuai hasilnya (mis. cek views dan interaksi sekitar 24 jam setelah tayang, atau akun yang gagal).
- Satu tawaran lanjutan yang konkret (mis. membandingkan hasilnya dengan rata-rata akun, membuat tugas berikutnya, mengulang akun yang gagal).

Aturan: hanya boleh memakai angka, akun, dan jam dari FAKTA. Jangan menjanjikan hasil (views atau kenaikan). Jangan menyebut nama model atau sistem di baliknya.`;

/**
 * Penutup setelah semua tugas selesai: fakta disusun deterministik dari hasil nyata, AI hanya menulis
 * penutupnya. Penutup AI yang memuat angka atau akun di luar fakta diganti penutup cadangan.
 */
export async function buildExecutionReply(exec: Execution): Promise<{ message: string; model: string | null }> {
  const facts = executionFacts(exec);
  const result = await generateWithFailover({
    system: CLOSING_SYSTEM,
    contents: [{ role: "user", parts: [{ text: `FAKTA:\n${facts}\n\nTulis penutupnya.` }] }],
    temperature: 0.5,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    deadlineMs: 25_000,
  }).catch(() => null);

  const handles = new Set(exec.tasks.flatMap((t) => t.accounts.map((a) => a.username.toLowerCase())));
  const text = result?.text.trim() ?? "";
  const valid = text.length >= 20 && text.length <= 900 && checkAnswer(text, numberPool(facts), handles).ok;
  return {
    message: composeExecutionMessage(exec, valid ? text : fallbackClosing(exec)),
    model: valid ? (result?.model ?? null) : null,
  };
}
