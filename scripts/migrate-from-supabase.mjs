// Migrasi data BotThreads secara selektif dari Supabase lama ke PostgreSQL VPS mandiri.
//
// Menyaring keluar seluruh sampah/data proyek Auto-Suka Shawarma:
//  - Hanya mengambil ScheduledPost dengan `source = 'DASHBOARD_AI'` (membuang 11.400+ post video/TikTok/IG Auto-Suka).
//  - Hanya mengambil SocialAccount dengan `platform = 'THREADS'`.
//  - Mengecualikan akun @maulanayusuf7923 (dan akun/workspace Shawarma lain bila diminta).
//  - Hanya mengambil Workspace yang benar-benar dipakai di BotThreads.
//
// Penggunaan:
//   npm run db:import-supabase -- --dry-run
//   npm run db:import-supabase
//   npm run db:import-supabase -- --exclude-shawarma-workspaces
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const excludeShawarmaWorkspaces = args.includes("--exclude-shawarma-workspaces");

const sbUrl = process.env.SUPABASE_URL?.trim();
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const pgUrl = (process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "").trim();

if (!sbUrl || !sbKey) {
  console.error("Set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (sumber data) di .env.local");
  process.exit(1);
}
if (!pgUrl && !dryRun) {
  console.error("Set DATABASE_URL (tujuan PostgreSQL VPS) di .env.local");
  process.exit(1);
}
if (pgUrl.includes("supabase.com") && !dryRun) {
  console.error("PERINGATAN: DATABASE_URL masih mengarah ke Supabase! Arahkan ke PostgreSQL VPS terlebih dahulu.");
  process.exit(1);
}

const sb = createClient(sbUrl, sbKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SHAWARMA_WORKSPACE_IDS = new Set([
  "c0000000-0000-4000-8000-000000000001", // Suka Shawarma
  "9402b3dd-e8f5-486e-af0e-01b919c6d625", // Suka Shawarma Life
  "af6d0831-3512-4899-9f32-1745422d71af", // Suka Shawarma Kemitraan
]);

const EXCLUDED_USERNAMES = new Set(["maulanayusuf7923"]);

async function fetchAll(table, filterFn = (q) => q, pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    let q = sb.from(table).select("*").range(from, from + pageSize - 1);
    q = filterFn(q);
    const { data, error } = await q;
    if (error) {
      if (/does not exist|PGRST205|42P01|permission denied|42501/i.test(error.message)) return [];
      throw new Error(`Gagal membaca ${table} dari Supabase: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function getTargetColumns(client, table) {
  const res = await client.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return res.rows;
}

async function upsertBatch(client, table, rows, conflictCols = ["id"]) {
  if (!rows.length) return 0;
  const colMeta = await getTargetColumns(client, table);
  if (!colMeta.length) return 0;
  const validCols = colMeta.map((c) => c.column_name);
  const jsonbCols = new Set(colMeta.filter((c) => c.udt_name === "jsonb" || c.udt_name === "json").map((c) => c.column_name));

  let total = 0;
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const presentCols = validCols.filter((c) => chunk.some((r) => r[c] !== undefined));
    if (!presentCols.length) continue;

    const params = [];
    const tuples = chunk.map((row) => {
      const placeholders = presentCols.map((col) => {
        const val = row[col];
        if (val === undefined || val === null) return "NULL";
        if (jsonbCols.has(col) && typeof val === "object") {
          params.push(JSON.stringify(val));
        } else {
          params.push(val);
        }
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    const colList = presentCols.map((c) => `"${c}"`).join(", ");
    const conflictClause = conflictCols.length ? ` ON CONFLICT DO NOTHING` : "";
    const sql = `INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(", ")}${conflictClause}`;
    const res = await client.query(sql, params);
    total += res.rowCount ?? chunk.length;
  }
  return total;
}

console.log("=== Memindai data BotThreads di Supabase ===");

const [
  rawWorkspaces,
  wsSettings,
  memberships,
  wsGroups,
  rawAccounts,
] = await Promise.all([
  fetchAll("Workspace"),
  fetchAll("WorkspaceSettings"),
  fetchAll("DashboardMembership"),
  fetchAll("DashboardWorkspaceGroup"),
  fetchAll("ThreadsAccount"),
]);

// Filter akun Threads: buang akun yang dikecualikan dan (opsional) workspace Shawarma
const accounts = rawAccounts.filter((a) => {
  const uname = (a.username || "").trim().toLowerCase();
  if (EXCLUDED_USERNAMES.has(uname)) return false;
  if (excludeShawarmaWorkspaces && SHAWARMA_WORKSPACE_IDS.has(a.workspaceId)) return false;
  return true;
});
const validAccountIds = new Set(accounts.map((a) => a.id));

// Kumpulkan ID workspace yang aktif dipakai BotThreads
const activeWorkspaceIds = new Set();
for (const a of accounts) if (a.workspaceId) activeWorkspaceIds.add(a.workspaceId);
for (const s of wsSettings) if (s.workspaceId) activeWorkspaceIds.add(s.workspaceId);
for (const m of memberships) if (m.workspaceId) activeWorkspaceIds.add(m.workspaceId);
for (const g of wsGroups) {
  if (g.workspaceId) activeWorkspaceIds.add(g.workspaceId);
  if (g.groupId) activeWorkspaceIds.add(g.groupId);
}
if (excludeShawarmaWorkspaces) {
  for (const id of SHAWARMA_WORKSPACE_IDS) activeWorkspaceIds.delete(id);
}

// Pastikan setiap workspaceId aktif memiliki baris di tabel Workspace
const wsById = new Map(rawWorkspaces.map((w) => [w.id, w]));
const workspaces = [];
for (const wsId of activeWorkspaceIds) {
  if (wsById.has(wsId)) {
    workspaces.push(wsById.get(wsId));
  } else {
    const setting = wsSettings.find((s) => s.workspaceId === wsId);
    const nama = setting?.namaBrand?.trim() || "Workspace";
    const slug = `${nama.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "ws"}-${wsId.slice(0, 8)}`;
    workspaces.push({
      id: wsId,
      nama,
      slug,
      postizEnabled: false,
      tiktokDirect: false,
      createdAt: new Date().toISOString().replace("Z", ""),
      updatedAt: new Date().toISOString().replace("Z", ""),
    });
  }
}

const rawSocials = await fetchAll("SocialAccount", (q) => q.eq("platform", "THREADS"));
const socials = rawSocials.filter((s) => !s.threadsAccountId || validAccountIds.has(s.threadsAccountId));
const neededOutletIds = new Set(socials.map((s) => s.outletId).filter(Boolean));

const rawPosts = await fetchAll("ScheduledPost", (q) => q.eq("source", "DASHBOARD_AI"));
const posts = rawPosts.filter((p) => !excludeShawarmaWorkspaces || !SHAWARMA_WORKSPACE_IDS.has(p.workspaceId));
const validPostIds = new Set(posts.map((p) => p.id));

const rawDispatches = await fetchAll("PostDispatch", (q) => q.eq("publisher", "THREADS"));
const dispatches = rawDispatches.filter((d) => validPostIds.has(d.postId));
for (const d of dispatches) if (d.outletId) neededOutletIds.add(d.outletId);

const rawOutlets = await fetchAll("Outlet");
const outlets = rawOutlets.filter((o) => neededOutletIds.has(o.id) || activeWorkspaceIds.has(o.workspaceId));

console.log(`  Workspace aktif BotThreads : ${workspaces.length} (dari ${rawWorkspaces.length})`);
console.log(`  ThreadsAccount             : ${accounts.length} (dari ${rawAccounts.length})`);
console.log(`  Outlet                     : ${outlets.length} (dari ${rawOutlets.length})`);
console.log(`  SocialAccount (THREADS)    : ${socials.length}`);
console.log(`  ScheduledPost (DASHBOARD)  : ${posts.length} (membuang ${12029 - posts.length}+ post Auto-Suka)`);
console.log(`  PostDispatch (THREADS)     : ${dispatches.length}`);

// Tabel-tabel lain milik BotThreads:
const OTHER_TABLES = [
  { name: "PlatformRole", conflict: ["id"] },
  { name: "DashboardUser", conflict: ["id"] },
  { name: "PlatformSettings", conflict: ["id"] },
  { name: "PlatformIntegration", conflict: ["id"] },
  { name: "PlatformAuditLog", conflict: ["id"] },
  { name: "Plan", conflict: ["id"] },
  { name: "WorkspaceSettings", conflict: ["workspaceId"], filterWs: "workspaceId" },
  { name: "DashboardWorkspaceGroup", conflict: ["workspaceId"], filterWs: "workspaceId" },
  { name: "DashboardMembership", conflict: ["workspaceId", "userId"], filterWs: "workspaceId" },
  { name: "DashboardMemberAccount", conflict: ["workspaceId", "userId", "accountId"], filterWs: "workspaceId", filterAcc: "accountId" },
  { name: "DashboardInvite", conflict: ["id"], filterWs: "workspaceId" },
  { name: "DashboardPasswordReset", conflict: ["id"] },
  { name: "DashboardAuditLog", conflict: ["id"], filterWs: "workspaceId" },
  { name: "DashboardNotification", conflict: ["id"], filterWs: "workspaceId" },
  { name: "DashboardPostLog", conflict: ["id"] },
  { name: "SubscriptionInvoice", conflict: ["id"], filterWs: "workspaceId" },
  { name: "ThreadsAccountDaily", conflict: ["threadsAccountId", "date"], filterAcc: "threadsAccountId" },
  { name: "ThreadsPostStat", conflict: ["mediaId"], filterAcc: "threadsAccountId" },
  { name: "AutopilotConfig", conflict: ["accountId"], filterAcc: "accountId" },
  { name: "AutopilotSlot", conflict: ["id"], filterAcc: "accountId" },
  { name: "AutopilotRun", conflict: ["id"], filterWs: "workspaceId" },
  { name: "TrendSignal", conflict: ["id"], filterWs: "workspaceId" },
  { name: "ContentIdea", conflict: ["id"], filterWs: "workspaceId" },
  { name: "ContentMoment", conflict: ["id"], filterWs: "workspaceId" },
  { name: "ContentOutcome", conflict: ["postId"], filterAcc: "accountId" },
  { name: "AccountStyleLesson", conflict: ["id"], filterAcc: "accountId" },
  { name: "StyleExample", conflict: ["id"], filterAcc: "accountId" },
  { name: "MediaUse", conflict: ["accountId", "imageKey"], filterAcc: "accountId" },
  { name: "AccountOnboarding", conflict: ["accountId"], filterAcc: "accountId" },
  { name: "AffiliateWorkspace", conflict: ["workspaceId"], filterWs: "workspaceId" },
  { name: "AffiliateProduct", conflict: ["id"], filterWs: "workspaceId" },
  { name: "AffiliateConfig", conflict: ["accountId"], filterAcc: "accountId" },
  { name: "AffiliateUse", conflict: ["id"], filterAcc: "accountId" },
  { name: "ThreadsReplySetting", conflict: ["accountId"], filterAcc: "accountId" },
  { name: "ThreadsComment", conflict: ["id"], filterAcc: "accountId" },
  { name: "AutoCommentSetting", conflict: ["threadsAccountId"], filterAcc: "threadsAccountId" },
  { name: "BtAutoCommentConfig", conflict: ["workspaceId"], filterWs: "workspaceId" },
  { name: "BtAutoCommentSetting", conflict: ["accountId"], filterAcc: "accountId" },
  { name: "BtAutoCommentTarget", conflict: ["id"], filterAcc: "accountId" },
  { name: "BtAutoCommentRun", conflict: ["id"], filterAcc: "accountId" },
  { name: "AnalyticsReportLog", conflict: ["id"] },
  { name: "KnowledgeBase", conflict: ["id"] },
];

const tablePayloads = [];
for (const spec of OTHER_TABLES) {
  let rows = await fetchAll(spec.name);
  if (spec.filterWs) {
    rows = rows.filter((r) => !r[spec.filterWs] || activeWorkspaceIds.has(r[spec.filterWs]));
  }
  if (spec.filterAcc) {
    rows = rows.filter((r) => !r[spec.filterAcc] || validAccountIds.has(r[spec.filterAcc]));
  }
  tablePayloads.push({ ...spec, rows });
  if (rows.length > 0) {
    console.log(`  ${spec.name.padEnd(27)}: ${rows.length} baris`);
  }
}

if (dryRun) {
  console.log("\nMode --dry-run selesai. Tidak ada data yang ditulis.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: pgUrl });
await client.connect();

try {
  console.log("\n=== Menyalin data ke PostgreSQL VPS ===");
  await upsertBatch(client, "Workspace", workspaces, ["id"]);
  await upsertBatch(client, "Outlet", outlets, ["id"]);
  await upsertBatch(client, "ThreadsAccount", accounts, ["id"]);
  await upsertBatch(client, "SocialAccount", socials, ["id"]);
  await upsertBatch(client, "ScheduledPost", posts, ["id"]);
  await upsertBatch(client, "PostDispatch", dispatches, ["id"]);

  for (const item of tablePayloads) {
    if (!item.rows.length) continue;
    const n = await upsertBatch(client, item.name, item.rows, item.conflict);
    console.log(`  [OK] ${item.name}: ${n} baris disalin`);
  }

  await client.query("ANALYZE");
  console.log("\nMigrasi data selesai dan statistik query planner (ANALYZE) telah diperbarui!");
} finally {
  await client.end();
}
