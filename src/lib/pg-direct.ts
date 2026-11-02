/**
 * Driver PostgreSQL langsung (Direct TCP Pool via `pg`) tanpa ketergantungan
 * container Supabase / PostgREST / GoTrue / Storage API.
 *
 * Fitur:
 *  1. Koneksi pool ringan (`max: 12`) lewat `DATABASE_URL` (atau `DIRECT_URL`).
 *  2. Eksekusi `rpc(fn, args)` langsung ke fungsi PL/pgSQL di PostgreSQL (< 1ms).
 *  3. Compiler SQL terparameterisasi untuk rantai `.from(table).select/insert/update/upsert/delete`
 *     termasuk relasi many-to-one (`ThreadsAccount(...)`, `Workspace(...)`, `Outlet(...)`, `ScheduledPost(...)`).
 *  4. Penyimpanan berkas media sementara di disk lokal VPS (`os.tmpdir()/botthreads-media`)
 *     yang disajikan lewat `/api/media/<bucket>/<path>`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool, types, type QueryResultRow } from "pg";

// Konfigurasi parser tipe PostgreSQL agar identik dengan keluaran JSON PostgREST:
// 1082 = DATE -> "YYYY-MM-DD"
types.setTypeParser(1082, (v: string) => v);
// 1114 = TIMESTAMP WITHOUT TIME ZONE -> "YYYY-MM-DDTHH:mm:ss.sss"
types.setTypeParser(1114, (v: string) => v.replace(" ", "T"));
// 1184 = TIMESTAMPTZ -> ISO UTC
types.setTypeParser(1184, (v: string) => new Date(v).toISOString());
// 20 = INT8 (BIGINT) -> number
types.setTypeParser(20, (v: string) => Number(v));
// 701 = FLOAT8, 1700 = NUMERIC -> number
types.setTypeParser(701, (v: string) => Number(v));
types.setTypeParser(1700, (v: string) => Number(v));

export interface PgResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
}

/** Fungsi SQL yang mengembalikan `RETURNS TABLE(...)` (baris majemuk, bukan skalar/jsonb tunggal). */
const TABLE_RPC_FUNCTIONS = new Set([
  "dash_daily_by_date",
  "dash_daily_by_account",
  "dash_latest_followers",
  "dash_posts_by_account",
  "dash_posts_by_media",
  "dash_reply_poll_targets",
]);

/** Peta relasi Foreign Key (BaseTable -> { RelatedTable: fkColumnOnBaseTable }). */
const FK_RELATIONS: Record<string, Record<string, string>> = {
  ThreadsPostStat: { ThreadsAccount: "threadsAccountId" },
  ThreadsAccountDaily: { ThreadsAccount: "threadsAccountId" },
  ThreadsAccount: { Workspace: "workspaceId" },
  PostDispatch: {
    Outlet: "outletId",
    ScheduledPost: "postId",
    SocialAccount: "socialAccountId",
  },
  ScheduledPost: { Workspace: "workspaceId" },
  SocialAccount: {
    Outlet: "outletId",
    ThreadsAccount: "threadsAccountId",
  },
  DashboardPostLog: { DashboardUser: "userId" },
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(ident: string): string {
  if (!IDENT_RE.test(ident)) {
    throw new Error(`Nama pengenal SQL tidak valid: ${ident}`);
  }
  return `"${ident}"`;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);

function serializeParam(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (isPlainObject(v) || (Array.isArray(v) && v.some(isPlainObject))) {
    return JSON.stringify(v);
  }
  return v;
}

/** Normalisasi nilai Date dari driver (mis. PGlite) menjadi string ISO seperti PostgREST. */
function normalizeRowValue(v: unknown, dateOnly = false): unknown {
  if (v instanceof Date) {
    return dateOnly ? v.toISOString().slice(0, 10) : v.toISOString().replace(/Z$/, "");
  }
  if (Array.isArray(v)) return v.map((item) => normalizeRowValue(item, dateOnly));
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = normalizeRowValue(val, k === "date");
    }
    return out;
  }
  return v;
}

/** Pisahkan daftar kolom tingkat atas (mengabaikan koma di dalam tanda kurung relasi). */
function splitSelectTokens(selectStr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of selectStr) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Susun daftar ekspresi SELECT beserta subquery relasi many-to-one. */
function buildSelectList(baseTable: string, selectStr: string): string {
  const trimmed = selectStr.trim();
  if (!trimmed || trimmed === "*") return `${quoteIdent(baseTable)}.*`;
  const tokens = splitSelectTokens(trimmed);
  const parts: string[] = [];
  for (const tok of tokens) {
    const relMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)$/.exec(tok);
    if (relMatch) {
      const [, relTable, innerColsRaw] = relMatch;
      const fkCol = FK_RELATIONS[baseTable]?.[relTable];
      if (!fkCol) {
        throw new Error(`Relasi ${baseTable} -> ${relTable} belum terdaftar`);
      }
      const innerCols = innerColsRaw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .map(quoteIdent)
        .join(", ");
      parts.push(
        `(SELECT row_to_json(_rel) FROM (SELECT ${innerCols} FROM ${quoteIdent(relTable)} WHERE "id" = ${quoteIdent(baseTable)}.${quoteIdent(fkCol)} LIMIT 1) _rel) AS ${quoteIdent(relTable)}`
      );
    } else {
      parts.push(`${quoteIdent(baseTable)}.${quoteIdent(tok)}`);
    }
  }
  return parts.join(", ");
}

/** Parse ekspresi `.or("username.eq.\"foo\",email.eq.\"foo\"")` menjadi klausa SQL terparameterisasi. */
function compileOrFilter(
  baseTable: string,
  expr: string,
  pushParam: (v: unknown) => string
): string {
  // Pisahkan koma tingkat atas di luar tanda kutip ganda
  const parts: string[] = [];
  let inQuotes = false;
  let cur = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '"' && expr[i - 1] !== "\\") inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());

  const clauses = parts.map((part) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|ilike|like)\.([\s\S]+)$/.exec(part);
    if (!m) throw new Error(`Filter .or() tidak didukung: ${part}`);
    const [, col, op, rawVal] = m;
    let val = rawVal.trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    const colRef = `${quoteIdent(baseTable)}.${quoteIdent(col)}`;
    if (op === "eq") {
      // Untuk email/username pada login, gunakan pencocokan case-insensitive yang aman
      return `lower(${colRef}) = lower(${pushParam(val)})`;
    }
    if (op === "neq") return `${colRef} <> ${pushParam(val)}`;
    if (op === "ilike") return `${colRef} ILIKE ${pushParam(val)}`;
    return `${colRef} LIKE ${pushParam(val)}`;
  });

  return `(${clauses.join(" OR ")})`;
}

type OpKind = "select" | "insert" | "update" | "upsert" | "delete";

interface OrderSpec {
  col: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

class PgQueryBuilder implements PromiseLike<PgResult> {
  private op: OpKind = "select";
  private selectCols = "*";
  private returningCols: string | null = null;
  private wantCount = false;
  private headOnly = false;
  private singleRow = false;
  private maybeSingleRow = false;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private conflictCols: string[] = [];
  private ignoreDuplicates = false;
  private whereClauses: ((push: (v: unknown) => string) => string)[] = [];
  private orders: OrderSpec[] = [];
  private limitVal: number | null = null;
  private offsetVal: number | null = null;

  constructor(
    private readonly exec: SqlExecutor,
    private readonly table: string
  ) {}

  select(
    cols = "*",
    opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }
  ): this {
    if (this.op === "select") {
      this.selectCols = cols;
      if (opts?.count) this.wantCount = true;
      if (opts?.head) this.headOnly = true;
    } else {
      this.returningCols = cols;
    }
    return this;
  }

  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
    opts?: { count?: "exact" }
  ): this {
    this.op = "insert";
    this.payload = values;
    if (opts?.count) this.wantCount = true;
    return this;
  }

  update(values: Record<string, unknown>, opts?: { count?: "exact" }): this {
    this.op = "update";
    this.payload = values;
    if (opts?.count) this.wantCount = true;
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: "exact" }
  ): this {
    this.op = "upsert";
    this.payload = values;
    this.conflictCols = (opts?.onConflict ?? "id")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    if (opts?.count) this.wantCount = true;
    return this;
  }

  delete(opts?: { count?: "exact" }): this {
    this.op = "delete";
    if (opts?.count) this.wantCount = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} = ${p(val)}`);
    return this;
  }

  neq(col: string, val: unknown): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} <> ${p(val)}`);
    return this;
  }

  gt(col: string, val: unknown): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} > ${p(val)}`);
    return this;
  }

  gte(col: string, val: unknown): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} >= ${p(val)}`);
    return this;
  }

  lt(col: string, val: unknown): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} < ${p(val)}`);
    return this;
  }

  lte(col: string, val: unknown): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} <= ${p(val)}`);
    return this;
  }

  like(col: string, pattern: string): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} LIKE ${p(pattern)}`);
    return this;
  }

  ilike(col: string, pattern: string): this {
    this.whereClauses.push((p) => `${quoteIdent(this.table)}.${quoteIdent(col)} ILIKE ${p(pattern)}`);
    return this;
  }

  is(col: string, val: null | boolean): this {
    const colRef = `${quoteIdent(this.table)}.${quoteIdent(col)}`;
    if (val === null) this.whereClauses.push(() => `${colRef} IS NULL`);
    else if (val === true) this.whereClauses.push(() => `${colRef} IS TRUE`);
    else this.whereClauses.push(() => `${colRef} IS FALSE`);
    return this;
  }

  in(col: string, vals: readonly unknown[]): this {
    const list = Array.from(vals);
    if (list.length === 0) {
      this.whereClauses.push(() => "FALSE");
      return this;
    }
    this.whereClauses.push((p) => {
      const placeholders = list.map((v) => p(v)).join(", ");
      return `${quoteIdent(this.table)}.${quoteIdent(col)} IN (${placeholders})`;
    });
    return this;
  }

  not(col: string, op: string, val: unknown): this {
    const colRef = `${quoteIdent(this.table)}.${quoteIdent(col)}`;
    if (op === "in") {
      const list = Array.isArray(val)
        ? val
        : typeof val === "string"
          ? val
              .replace(/^\(|\)$/g, "")
              .split(",")
              .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
              .filter(Boolean)
          : [];
      if (list.length === 0) return this;
      this.whereClauses.push((p) => `${colRef} NOT IN (${list.map((v) => p(v)).join(", ")})`);
      return this;
    }
    if (op === "is" && val === null) {
      this.whereClauses.push(() => `${colRef} IS NOT NULL`);
      return this;
    }
    if (op === "eq") {
      this.whereClauses.push((p) => `${colRef} IS DISTINCT FROM ${p(val)}`);
      return this;
    }
    throw new Error(`Operator .not(${col}, ${op}) tidak didukung`);
  }

  or(expr: string): this {
    this.whereClauses.push((p) => compileOrFilter(this.table, expr, p));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({
      col,
      ascending: opts?.ascending ?? true,
      nullsFirst: opts?.nullsFirst,
    });
    return this;
  }

  limit(n: number): this {
    this.limitVal = Math.max(0, Math.floor(n));
    return this;
  }

  range(from: number, to: number): this {
    const start = Math.max(0, Math.floor(from));
    const end = Math.max(start, Math.floor(to));
    this.offsetVal = start;
    this.limitVal = end - start + 1;
    return this;
  }

  single(): this {
    this.singleRow = true;
    if (this.op === "select" && this.limitVal === null) this.limitVal = 1;
    return this;
  }

  maybeSingle(): this {
    this.maybeSingleRow = true;
    if (this.op === "select" && this.limitVal === null) this.limitVal = 1;
    return this;
  }

  private buildWhere(pushParam: (v: unknown) => string): string {
    if (!this.whereClauses.length) return "";
    return ` WHERE ${this.whereClauses.map((fn) => fn(pushParam)).join(" AND ")}`;
  }

  private buildOrderLimit(): string {
    let sql = "";
    if (this.orders.length) {
      const ord = this.orders
        .map((o) => {
          const dir = o.ascending ? "ASC" : "DESC";
          const nulls =
            o.nullsFirst === undefined ? "" : o.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
          return `${quoteIdent(this.table)}.${quoteIdent(o.col)} ${dir}${nulls}`;
        })
        .join(", ");
      sql += ` ORDER BY ${ord}`;
    }
    if (this.limitVal !== null) sql += ` LIMIT ${this.limitVal}`;
    if (this.offsetVal !== null) sql += ` OFFSET ${this.offsetVal}`;
    return sql;
  }

  private async run(): Promise<PgResult> {
    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(serializeParam(v));
      return `$${params.length}`;
    };

    try {
      const tbl = quoteIdent(this.table);

      if (this.op === "select") {
        const whereSql = this.buildWhere(pushParam);
        if (this.headOnly && this.wantCount) {
          const countRes = await this.exec.query<{ c: number }>(
            `SELECT COUNT(*)::int AS c FROM ${tbl}${whereSql}`,
            params
          );
          return { data: null, error: null, count: countRes.rows[0]?.c ?? 0 };
        }

        const selectExpr = buildSelectList(this.table, this.selectCols);
        const orderLimitSql = this.buildOrderLimit();

        if (this.wantCount) {
          const countParams = [...params];
          const [dataRes, countRes] = await Promise.all([
            this.exec.query(`SELECT ${selectExpr} FROM ${tbl}${whereSql}${orderLimitSql}`, params),
            this.exec.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${tbl}${whereSql}`, countParams),
          ]);
          const rows = dataRes.rows.map((r) => normalizeRowValue(r));
          const count = countRes.rows[0]?.c ?? 0;
          if (this.singleRow || this.maybeSingleRow) {
            if (this.singleRow && rows.length === 0) {
              return { data: null, error: { message: "Baris tidak ditemukan", code: "PGRST116" }, count };
            }
            return { data: rows[0] ?? null, error: null, count };
          }
          return { data: rows, error: null, count };
        }

        const res = await this.exec.query(
          `SELECT ${selectExpr} FROM ${tbl}${whereSql}${orderLimitSql}`,
          params
        );
        const rows = res.rows.map((r) => normalizeRowValue(r));
        if (this.singleRow || this.maybeSingleRow) {
          if (this.singleRow && rows.length === 0) {
            return { data: null, error: { message: "Baris tidak ditemukan", code: "PGRST116" } };
          }
          return { data: rows[0] ?? null, error: null };
        }
        return { data: rows, error: null };
      }

      if (this.op === "insert" || this.op === "upsert") {
        const rows = Array.isArray(this.payload)
          ? this.payload
          : this.payload
            ? [this.payload]
            : [];
        if (rows.length === 0) return { data: [], error: null };

        // Kumpulkan semua nama kolom yang muncul di baris mana pun (nilai undefined dilewati)
        const colSet = new Set<string>();
        for (const r of rows) {
          for (const [k, v] of Object.entries(r)) {
            if (v !== undefined) colSet.add(k);
          }
        }
        const cols = Array.from(colSet);
        const colListSql = cols.map(quoteIdent).join(", ");
        const valuesTuples = rows
          .map(
            (r) =>
              `(${cols.map((c) => (r[c] === undefined ? "DEFAULT" : pushParam(r[c]))).join(", ")})`
          )
          .join(", ");

        let conflictSql = "";
        if (this.op === "upsert") {
          const targetCols = this.conflictCols.map(quoteIdent).join(", ");
          if (this.ignoreDuplicates) {
            conflictSql = ` ON CONFLICT (${targetCols}) DO NOTHING`;
          } else {
            const updateCols = cols.filter((c) => !this.conflictCols.includes(c) && c !== "id");
            if (updateCols.length === 0) {
              conflictSql = ` ON CONFLICT (${targetCols}) DO NOTHING`;
            } else {
              const sets = updateCols
                .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
                .join(", ");
              conflictSql = ` ON CONFLICT (${targetCols}) DO UPDATE SET ${sets}`;
            }
          }
        }

        const retSql = this.returningCols
          ? ` RETURNING ${buildSelectList(this.table, this.returningCols)}`
          : "";
        const res = await this.exec.query(
          `INSERT INTO ${tbl} (${colListSql}) VALUES ${valuesTuples}${conflictSql}${retSql}`,
          params
        );
        const out = this.returningCols ? res.rows : null;
        if (this.singleRow || this.maybeSingleRow) {
          return { data: out ? (out[0] ?? null) : null, error: null };
        }
        return { data: out, error: null };
      }

      if (this.op === "update") {
        const patch = (this.payload ?? {}) as Record<string, unknown>;
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return { data: [], error: null };
        const setSql = entries.map(([k, v]) => `${quoteIdent(k)} = ${pushParam(v)}`).join(", ");
        const whereSql = this.buildWhere(pushParam);
        const retSql = this.returningCols
          ? ` RETURNING ${buildSelectList(this.table, this.returningCols)}`
          : "";
        const res = await this.exec.query(
          `UPDATE ${tbl} SET ${setSql}${whereSql}${retSql}`,
          params
        );
        const out = this.returningCols ? res.rows : null;
        if (this.singleRow || this.maybeSingleRow) {
          return { data: out ? (out[0] ?? null) : null, error: null };
        }
        return { data: out, error: null };
      }

      if (this.op === "delete") {
        const whereSql = this.buildWhere(pushParam);
        const retSql = this.returningCols
          ? ` RETURNING ${buildSelectList(this.table, this.returningCols)}`
          : "";
        const res = await this.exec.query(`DELETE FROM ${tbl}${whereSql}${retSql}`, params);
        const out = this.returningCols ? res.rows : null;
        if (this.singleRow || this.maybeSingleRow) {
          return { data: out ? (out[0] ?? null) : null, error: null };
        }
        return { data: out, error: null };
      }

      return { data: null, error: { message: "Operasi tidak dikenal" } };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return {
        data: null,
        error: { message: e.message ?? String(err), code: e.code },
      };
    }
  }

  then<TResult1 = PgResult, TResult2 = never>(
    onfulfilled?: ((value: PgResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/* ------------------------------------------------------------------ Penyimpanan Media Lokal */

export function getLocalMediaRoot(): string {
  return process.env.MEDIA_STORAGE_DIR?.trim() || path.join(os.tmpdir(), "botthreads-media");
}

function resolveSafeMediaPath(bucket: string, relPath: string): string {
  if (!/^[a-z0-9_-]{1,64}$/i.test(bucket)) {
    throw new Error("Nama bucket tidak valid");
  }
  const cleanRel = relPath.replace(/^\/+/, "");
  if (!cleanRel || cleanRel.includes("..") || cleanRel.includes("\\") || cleanRel.includes("\0")) {
    throw new Error("Path berkas tidak valid");
  }
  const root = path.resolve(getLocalMediaRoot(), bucket);
  const full = path.resolve(root, cleanRel);
  if (!full.startsWith(root + path.sep)) {
    throw new Error("Path berkas di luar direktori penyimpanan");
  }
  return full;
}

function createLocalStorage(bucket: string) {
  return {
    upload: async (
      relPath: string,
      body: Buffer | Uint8Array,
      _opts?: Record<string, unknown>
    ): Promise<{ data: { path: string } | null; error: { message: string } | null }> => {
      try {
        const full = resolveSafeMediaPath(bucket, relPath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, body);
        return { data: { path: relPath }, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    getPublicUrl: (relPath: string): { data: { publicUrl: string } } => {
      const origin = (process.env.APP_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
      const cleanRel = relPath.replace(/^\/+/, "");
      return {
        data: { publicUrl: `${origin}/api/media/${bucket}/${cleanRel}` },
      };
    },
    remove: async (
      relPaths: string[]
    ): Promise<{ data: string[] | null; error: { message: string } | null }> => {
      try {
        for (const p of relPaths) {
          if (!p) continue;
          const full = resolveSafeMediaPath(bucket, p);
          await fs.unlink(full).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== "ENOENT") throw err;
          });
          // Bersihkan subdirektori tmp/<postId> bila sudah kosong
          await fs.rmdir(path.dirname(full)).catch(() => undefined);
        }
        return { data: relPaths, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };
}

/** Cari berkas lokal di `tmp/<postId>/<n>.jpg` yang lebih tua dari `beforeMs` (untuk penyapu yatim). */
export async function listLocalTmpOrphans(
  bucket: string,
  beforeMs: number,
  limit = 50
): Promise<string[]> {
  const out: string[] = [];
  const tmpDir = path.resolve(getLocalMediaRoot(), bucket, "tmp");
  let postDirs: string[];
  try {
    postDirs = await fs.readdir(tmpDir);
  } catch {
    return out;
  }
  for (const postId of postDirs) {
    if (out.length >= limit) break;
    const subDir = path.join(tmpDir, postId);
    let files: string[];
    try {
      files = await fs.readdir(subDir);
    } catch {
      continue;
    }
    if (files.length === 0) {
      await fs.rmdir(subDir).catch(() => undefined);
      continue;
    }
    for (const f of files) {
      if (out.length >= limit) break;
      const full = path.join(subDir, f);
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs < beforeMs) {
          out.push(`tmp/${postId}/${f}`);
        }
      } catch {
        // sudah terhapus
      }
    }
  }
  return out;
}

export { resolveSafeMediaPath };

/* ------------------------------------------------------------------ Klien Utama */

export function createPgClient(exec: SqlExecutor) {
  return {
    from: (table: string) => new PgQueryBuilder(exec, table),
    rpc: async (fn: string, args: Record<string, unknown> = {}): Promise<PgResult> => {
      try {
        if (!IDENT_RE.test(fn)) throw new Error(`Nama fungsi RPC tidak valid: ${fn}`);
        const keys = Object.keys(args).filter((k) => args[k] !== undefined);
        const values = keys.map((k) => serializeParam(args[k]));
        const namedArgs = keys.map((k, i) => `${quoteIdent(k)} => $${i + 1}`).join(", ");
        const sql = TABLE_RPC_FUNCTIONS.has(fn)
          ? `SELECT COALESCE(jsonb_agg(row_to_json(_t)), '[]'::jsonb) AS r FROM ${quoteIdent(fn)}(${namedArgs}) _t`
          : `SELECT ${quoteIdent(fn)}(${namedArgs}) AS r`;
        const res = await exec.query<{ r: unknown }>(sql, values);
        const raw = res.rows[0]?.r ?? null;
        return {
          data: normalizeRowValue(raw, fn === "dash_daily_max_date"),
          error: null,
        };
      } catch (err) {
        const e = err as { message?: string; code?: string };
        return {
          data: null,
          error: { message: e.message ?? String(err), code: e.code },
        };
      }
    },
    storage: {
      from: (bucket: string) => createLocalStorage(bucket),
    },
  };
}

let globalPool: Pool | null = null;
let globalPoolUrl: string | null = null;

export function getPgPool(): Pool {
  const url = (process.env.DATABASE_URL || process.env.DIRECT_URL || "").trim();
  if (!url) {
    throw new Error("DATABASE_URL belum diatur");
  }
  if (globalPool && globalPoolUrl === url) return globalPool;
  globalPool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX) || 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  globalPoolUrl = url;
  return globalPool;
}
