/**
 * Rencana aksi otomatis dari saran asisten (murni, tanpa I/O).
 *
 * Alur: asisten memberi saran -> pengguna meminta "kerjakan saran ini" -> server meminta AI
 * mengekstrak tugas yang BISA dikerjakan sistem -> klien menampilkan kartu rencana dan bertanya
 * satu hal saja (jadwal di jam ramai atau posting sekarang) -> orkestrator mengerjakan semuanya.
 *
 * Sistem hanya bisa menulis dan memposting/menjadwalkan konten Threads per akun, jadi hanya tugas
 * jenis itu yang masuk rencana. Saran lain (mis. "kurangi frekuensi") tidak dijanjikan.
 */
import { MAX_BRIEF_CHARS } from "./content-validation";
import type { GeminiSchema } from "./gemini";

export const MAX_PLAN_TASKS = 3;
const MAX_TITLE = 70;
const MAX_REASON = 160;

export interface ActionPlanTask {
  title: string;
  /** Arahan isi untuk penulis AI (satu per tugas). */
  topic: string;
  reason: string;
  /** null = semua akun siap. */
  accountIds: string[] | null;
  /** Nama akun untuk ditampilkan (kosong bila semua akun). */
  accountNames: string[];
}

export interface ActionPlan {
  tasks: ActionPlanTask[];
  readyCount: number;
  /** false bila saklar posting dimatikan: hasilnya hanya draf untuk ditinjau. */
  publishEnabled: boolean;
}

const EXECUTE_VERB = String.raw`(?:kerjakan|kerjain|eksekusi|laksanakan|terapkan|realisasikan|praktikkan|implementasikan|jalankan|lakukan)`;
const ADVICE_NOUN = String.raw`(?:saran|rekomendasi|langkah|rencana|strategi)`;

const STRONG = new RegExp(String.raw`\b${EXECUTE_VERB}\b[^.!?\n]{0,30}\b${ADVICE_NOUN}\b`, "i");
const SOFT = /\b(?:kerjakan|kerjain|eksekusi|laksanakan)\b[^.!?\n]{0,20}\b(?:tadi|itu|ini|semua(?:nya)?|otomatis|aja|saja)\b/i;
const CONFIRM =
  /^\s*(?:ya|iya|oke|ok|gas|sip|lanjut|boleh)?\s*[,.!]*\s*(?:kerjakan|kerjain|eksekusi|laksanakan)(?:\s+(?:aja|saja|dong|sekarang|ya|semua(?:nya)?))*\s*[.!]*\s*$/i;
/** Pertanyaan bukan perintah: "apa langkah yang harus saya lakukan?" tidak boleh memicu eksekusi. */
const QUESTION = /\?|^\s*(?:apa|apakah|bagaimana|gimana|kenapa|mengapa|berapa|siapa|kapan|dimana|mana)\b/i;
const NOT_PLAN = /\b(?:orkestra(?:si|tor)|orchestrator|multi[- ]?agen(?:t)?)\b/i;

/**
 * Pengguna meminta saran sebelumnya dikerjakan. `lastBotText` = jawaban asisten terakhir; konfirmasi
 * singkat ("kerjakan aja") hanya dihitung bila jawaban itu memang memuat saran/langkah.
 */
export function isExecuteIntent(text: string, lastBotText = ""): boolean {
  const t = text.trim();
  if (!t || t.length > 200 || NOT_PLAN.test(t) || QUESTION.test(t)) return false;
  if (STRONG.test(t) || SOFT.test(t)) return true;
  return CONFIRM.test(t) && /langkah|saran|rekomendasi|rencana/i.test(lastBotText);
}

/** Jawaban asisten yang jadi sumber rencana: yang terbaru dan cukup panjang, selain itu yang terakhir. */
export function pickAdviceText(history: Array<{ sender?: unknown; text?: unknown }>): string {
  const bots = history
    .filter((h) => h?.sender === "bot" && typeof h.text === "string")
    .map((h) => String(h.text));
  if (bots.length === 0) return "";
  const longEnough = [...bots].reverse().find((t) => t.length >= 200);
  return (longEnough ?? bots[bots.length - 1]).slice(0, 6000);
}

export const PLAN_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    tasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "judul tugas, maksimal 70 karakter" },
          accounts: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "username akun dari DAFTAR AKUN tanpa @; kosong berarti semua akun siap",
          },
          topic: { type: "STRING", description: "arahan isi postingan, satu atau dua kalimat konkret" },
          reason: { type: "STRING", description: "satu kalimat alasan, mengacu pada saran" },
        },
        required: ["title", "accounts", "topic", "reason"],
      },
    },
    notExecutable: {
      type: "STRING",
      nullable: true,
      description: "bila tidak ada tugas yang bisa dikerjakan: alasan singkat",
    },
  },
  required: ["tasks"],
};

export const PLAN_SYSTEM = `Anda perencana tindakan untuk dashboard Threads Suka Shawarma. Dari SARAN asisten sebelumnya, ambil tugas yang BISA dikerjakan sistem.

Yang bisa dikerjakan sistem hanya satu hal: MENULIS lalu MEMPOSTING atau MENJADWALKAN konten Threads, satu postingan per akun, dengan satu arahan topik per tugas. Penulisnya otomatis memakai gaya akun dan jam ramai akun itu.
Yang TIDAK bisa: mengubah frekuensi posting, mengganti profil, menghapus akun, analisis, atau hal di luar konten.

Aturan:
- Maksimal ${MAX_PLAN_TASKS} tugas. Gabungkan saran yang mirip. Urutkan dari paling berdampak.
- title: ringkas, maksimal ${MAX_TITLE} karakter.
- accounts: username dari DAFTAR AKUN (tanpa @). Kosongkan hanya bila saran memang berlaku untuk semua akun. Jangan memakai akun di luar daftar.
- topic: arahan isi yang konkret dan bisa langsung ditulis (format, sudut, pola yang ditiru, topik), maksimal ${MAX_BRIEF_CHARS} karakter. Jangan mengarang angka, harga, promo, atau detail menu.
- reason: satu kalimat yang mengacu pada saran.
- Bila tidak ada langkah yang bisa dikerjakan lewat konten, kembalikan tasks kosong dan isi notExecutable.`;

export interface PlanAccount {
  id: string;
  username: string | null;
  displayName: string;
}

interface RawPlan {
  tasks?: Array<{ title?: unknown; accounts?: unknown; topic?: unknown; reason?: unknown }>;
  notExecutable?: unknown;
}

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Validasi keluaran AI: akun harus ada di daftar siap, teks dibatasi, maksimal 3 tugas. */
export function normalizePlan(
  json: unknown,
  accounts: PlanAccount[]
): { tasks: ActionPlanTask[]; notExecutable: string | null } {
  const raw = (json && typeof json === "object" ? json : {}) as RawPlan;
  const byName = new Map<string, PlanAccount>();
  for (const a of accounts) if (a.username) byName.set(a.username.toLowerCase(), a);

  const tasks: ActionPlanTask[] = [];
  for (const t of Array.isArray(raw.tasks) ? raw.tasks : []) {
    if (tasks.length >= MAX_PLAN_TASKS) break;
    const title = clean(t.title, MAX_TITLE);
    const topic = clean(t.topic, MAX_BRIEF_CHARS);
    if (!title || !topic) continue;

    const wanted = (Array.isArray(t.accounts) ? t.accounts : [])
      .map((u) => clean(u, 60).replace(/^@/, "").toLowerCase())
      .filter(Boolean);
    const matched = [...new Set(wanted)].map((u) => byName.get(u)).filter((a): a is PlanAccount => !!a);
    // Akun disebut tetapi tidak satu pun dikenal: tugas dilewati, bukan diperluas ke semua akun.
    if (wanted.length > 0 && matched.length === 0) continue;

    tasks.push({
      title,
      topic,
      reason: clean(t.reason, MAX_REASON),
      accountIds: wanted.length === 0 ? null : matched.map((a) => a.id),
      accountNames: wanted.length === 0 ? [] : matched.map((a) => a.username ?? a.displayName),
    });
  }
  const note = clean(raw.notExecutable, 240);
  return { tasks, notExecutable: tasks.length === 0 ? note || null : null };
}
