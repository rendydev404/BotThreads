/**
 * Postgres in-memory (PGlite) untuk uji integrasi: tabel cermin milik auto-suka + berkas SQL dashboard
 * yang sebenarnya, sehingga fungsi RPC diuji persis seperti yang akan dijalankan di Supabase.
 * `pgRpc` meniru pemanggilan PostgREST (argumen bernama).
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const REPO = path.resolve(__dirname, "../../../..");

/** Skema minimal tabel milik auto-suka (kolom yang dipakai fungsi dash_*), dengan enum seperti aslinya. */
const AUTO_SUKA_SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE "PostStatus" AS ENUM ('DRAF','MENUNGGU','DIPROSES','SELESAI','GAGAL');
CREATE TYPE "DispatchStatus" AS ENUM ('DRAF','MENUNGGU','TERBIT','GAGAL');
CREATE TYPE "TargetType" AS ENUM ('SEMUA_OUTLET','CLUSTER','PILIH_OUTLET','SATU_OUTLET');
CREATE TABLE "Workspace" (id text PRIMARY KEY, nama text, slug text);
CREATE TABLE "Outlet" (id text PRIMARY KEY, "workspaceId" text, nama text, "isActive" boolean DEFAULT true);
CREATE TABLE "ThreadsAccount" (id text PRIMARY KEY, "workspaceId" text, username text, "displayName" text, "avatarUrl" text,
  "needsReconnect" boolean DEFAULT false, "accessExpiresAt" timestamp(3), scopes text[] DEFAULT '{}', "accessToken" text);
CREATE TABLE "SocialAccount" (id text PRIMARY KEY, "outletId" text, "threadsAccountId" text);
CREATE TABLE "ThreadsPostStat" (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, "threadsAccountId" text, "mediaId" text UNIQUE,
  "mediaType" text DEFAULT 'TEXT', text text DEFAULT '', permalink text, "isQuote" boolean DEFAULT false, "postedAt" timestamp(3),
  views int DEFAULT 0, likes int DEFAULT 0, replies int DEFAULT 0, reposts int DEFAULT 0, quotes int DEFAULT 0, shares int DEFAULT 0,
  "metricsUpdatedAt" timestamp(3));
CREATE TABLE "ThreadsAccountDaily" (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, "threadsAccountId" text, date date,
  followers int DEFAULT 0, views int DEFAULT 0, likes int DEFAULT 0, replies int DEFAULT 0, reposts int DEFAULT 0, quotes int DEFAULT 0);
CREATE TABLE "ScheduledPost" (id text PRIMARY KEY, "workspaceId" text, judul text, caption text, hashtags text[], "mediaType" text,
  placement text, "videoUrl" text, "mediaUrls" text[], "mediaPaths" text[], "targetType" "TargetType", "tayangPada" timestamp(3),
  status "PostStatus" DEFAULT 'MENUNGGU', source text, "draftGroupId" text, "updatedAt" timestamp(3));
CREATE TABLE "PostDispatch" (id text PRIMARY KEY, "postId" text REFERENCES "ScheduledPost"(id) ON DELETE CASCADE, "outletId" text,
  "socialAccountId" text, publisher text, status "DispatchStatus" DEFAULT 'MENUNGGU', "releaseUrl" text, "platformPostId" text,
  "platformContainerId" text, attempts int DEFAULT 0, "lockedAt" timestamp(3), "pesanError" text,
  "createdAt" timestamp(3) DEFAULT now(), "updatedAt" timestamp(3));
-- Seperti di produksi: tabel dibuat Prisma (@default(uuid()) di sisi aplikasi), jadi id TANPA default database.
CREATE TABLE "DashboardUser" (id text PRIMARY KEY, username text UNIQUE, email text, name text,
  "passwordHash" text, "isActive" boolean DEFAULT true, "lastLoginAt" timestamp(3),
  "createdAt" timestamp(3) DEFAULT now(), "updatedAt" timestamp(3) DEFAULT now());
`;

export type TestDb = PGlite;

/** Basis data baru berisi skema auto-suka tiruan + berkas SQL dashboard yang diminta (relatif ke akar repo). */
export async function bootDb(sqlFiles: string[]): Promise<TestDb> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(AUTO_SUKA_SCHEMA);
  for (const file of sqlFiles) {
    try {
      await db.exec(fs.readFileSync(path.join(REPO, file), "utf8"));
    } catch (err) {
      throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return db;
}

/**
 * Klien Supabase tiruan untuk `vi.mock("@supabase/supabase-js")`: `rpc` diteruskan ke Postgres
 * in-memory dengan bentuk balasan `{ data, error }` seperti aslinya, dan `from(table)` hanya bisa
 * membaca baris tabel yang didaftarkan di `tables` (hanya filter `.eq()` yang dihormati; tabel lain kosong).
 * Dengan ini modul `@/lib/supabase` berjalan apa adanya, termasuk fungsi yang memanggil `db()` secara internal.
 */
export function pgClient(getDb: () => TestDb, tables: Record<string, string> = {}) {
  const from = (table: string): unknown => {
    let single = false;
    const eq: [string, unknown][] = [];
    const chain: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
              const sql = tables[table];
              if (!sql) return resolve({ data: single ? null : [], error: null });
              getDb()
                .query(sql)
                .then((r) => {
                  const rows = (r.rows as Record<string, unknown>[]).filter((row) => eq.every(([col, val]) => row[col] === val));
                  resolve({ data: single ? rows[0] ?? null : rows, error: null });
                }, reject);
            };
          }
          if (prop === "maybeSingle" || prop === "single") single = true;
          if (prop === "eq") {
            return (col: string, val: unknown) => {
              eq.push([col, val]);
              return chain;
            };
          }
          return () => chain;
        },
      }
    );
    return chain;
  };
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    pgRpc(getDb(), fn, args).then(
      (data) => ({ data, error: null }),
      (err: Error) => {
        // pgRpc sudah membungkus pesan seperti must(); kembalikan ke bentuk mentah PostgREST.
        const m = /^Supabase: ([\s\S]*?)(?: \(([A-Z0-9]+)\))?$/.exec(err.message);
        return { data: null, error: { message: m?.[1] ?? err.message, code: m?.[2] } };
      }
    );
  return { from, rpc: call };
}

/**
 * Pengganti modul `@supabase/supabase-js` untuk `vi.mock`: klien menuju Postgres in-memory, dengan
 * daftar akun Threads tersaji lewat PostgREST tiruan. `calls` (opsional) mencatat nama RPC yang dipanggil;
 * `extraTables` menambah tabel lain yang boleh dibaca langsung (nama -> SQL).
 * Pakai bersama `useTestSupabaseEnv()` supaya `db()` asli mau membuat klien.
 */
export function supabaseMock(getDb: () => TestDb, calls?: string[], extraTables: Record<string, string> = {}) {
  const client = pgClient(getDb, { ThreadsAccount: `SELECT id, username, "workspaceId" FROM "ThreadsAccount" ORDER BY id`, ...extraTables });
  return {
    createClient: () => ({
      from: client.from,
      rpc: (fn: string, args: Record<string, unknown> = {}) => {
        calls?.push(fn);
        return client.rpc(fn, args);
      },
    }),
  };
}

/** Variabel lingkungan minimal supaya `db()` di `@/lib/supabase` bisa dipanggil pada uji. */
export function useTestSupabaseEnv(): void {
  process.env.SUPABASE_URL = "http://uji.lokal";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "kunci-uji";
}

const isPlainObject = (v: unknown): boolean => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** Panggil fungsi SQL dengan argumen bernama, seperti `supabase.rpc`. Argumen undefined dibuang. */
export async function pgRpc<T>(db: TestDb, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const keys = Object.keys(args).filter((k) => args[k] !== undefined);
  const values = keys.map((k) => {
    const v = args[k];
    if (v instanceof Date) return v.toISOString();
    // jsonb: objek dan array berisi objek dikirim sebagai teks JSON (tanggal di dalamnya menjadi ISO).
    if (isPlainObject(v) || (Array.isArray(v) && v.some(isPlainObject))) return JSON.stringify(v);
    return v;
  });
  try {
    const res = await db.query<{ r: T }>(`SELECT ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) AS r`, values);
    return res.rows[0].r;
  } catch (err) {
    // Bentuk pesan sama dengan `must()` di supabase.ts, supaya deteksi galat (kode SQLSTATE) ikut teruji.
    const e = err as { message?: string; code?: string };
    throw new Error(`Supabase: ${e.message ?? String(err)}${e.code ? ` (${e.code})` : ""}`);
  }
}
