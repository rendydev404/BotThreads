/**
 * Uji isolasi multi-user (PRD FR-M11): route asli + SQL asli (sql/002-008 di Postgres in-memory).
 * Yang di-mock hanya transport database dan pembacaan cookie sesi. Tiap skenario memanggil endpoint
 * sebagai pengguna workspace/lingkup lain dan memastikan tidak ada data yang bocor atau berubah.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

// Klien Supabase diganti di tingkat pustakanya, jadi `@/lib/supabase` (termasuk penentu lingkup akun
// yang memanggil `db()` secara internal) berjalan apa adanya. PostgREST tiruan hanya menyajikan daftar akun.
vi.mock("@supabase/supabase-js", async () => {
  const { pgClient } = await import("./helpers/pg");
  return {
    createClient: () =>
      pgClient(() => h.db as TestDb, {
        ThreadsAccount: `SELECT id, username, "workspaceId" FROM "ThreadsAccount" ORDER BY id`,
      }),
  };
});

// Sesi tiruan: nilai cookie `session` langsung menjadi id pengguna.
vi.mock("@/lib/users", async (original) => ({
  ...(await original<typeof import("@/lib/users")>()),
  getSessionUserId: async (cookie: string | undefined) => cookie || null,
}));

import { NextRequest } from "next/server";
import { bootDb } from "./helpers/pg";
import { upsertConfigs, updateSlot } from "../autopilot-store";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { listPublishAccounts } from "../publish-accounts";
import { forgetMembership } from "../request-ctx";
import { accountScope, excludedIdList, scopedIds } from "../supabase";
import { hashToken } from "../team-service";
import { makeScope, runScoped, scopeKey } from "../tenant-scope";
import { GET as accountsGET } from "@/app/api/threads/accounts/route";
import { PUT as autopilotAccountPUT } from "@/app/api/autopilot/accounts/[id]/route";
import { GET as overviewGET } from "@/app/api/autopilot/overview/route";
import { POST as slotPOST } from "@/app/api/autopilot/slots/[id]/route";
import { GET as slotsGET } from "@/app/api/autopilot/slots/route";
import { GET as inviteGET, POST as invitePOST } from "@/app/api/auth/invite/route";
import { GET as meGET, POST as mePOST } from "@/app/api/auth/me/route";
import { POST as resetPOST } from "@/app/api/auth/reset/route";
import { GET as auditGET } from "@/app/api/audit/route";
import { DELETE as postDELETE, PATCH as postPATCH } from "@/app/api/content/posts/[id]/route";
import { GET as postsGET, POST as postsPOST } from "@/app/api/content/posts/route";
import { DELETE as memberDELETE, PATCH as memberPATCH, POST as memberResetPOST } from "@/app/api/team/members/[id]/route";
import { GET as teamGET, POST as teamPOST } from "@/app/api/team/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/workspace/settings/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");

const req = (user: string | null, url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { cookie: `session=${user}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const param = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const count = async (sql: string): Promise<number> => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n;

beforeAll(async () => {
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.SUPABASE_URL = "http://uji.lokal";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "kunci-uji";
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
    "sql/007_autopilot_learning.sql",
  ]);
  h.db = db;

  await db.exec(`
    INSERT INTO "Workspace" VALUES ('ws1', 'Brand Satu', 'brand-satu'), ('ws2', 'Brand Dua', 'brand-dua');
    ${[
      ["a1", "ws1"],
      ["a2", "ws1"],
      ["a3", "ws2"],
    ]
      .map(
        ([a, ws]) => `
    INSERT INTO "Outlet" VALUES ('o-${a}', '${ws}', 'Cabang ${a}', true);
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
      VALUES ('${a}', '${ws}', 'akun_${a}', 'Akun ${a}', '2099-01-01', '{threads_content_publish}');
    INSERT INTO "SocialAccount" VALUES ('s-${a}', 'o-${a}', '${a}');
    INSERT INTO "ScheduledPost" (id, "workspaceId", caption, hashtags, "tayangPada", status, source)
      VALUES ('post-${a}', '${ws}', 'antrean milik ${a}', '{}', '2099-01-01T05:00:00', 'MENUNGGU', 'DASHBOARD_AI');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status)
      VALUES ('disp-${a}', 'post-${a}', 'o-${a}', 's-${a}', 'THREADS', 'MENUNGGU');`
      )
      .join("\n")}
    -- Pengguna yang sudah ada sebelum fitur multi-user dipasang.
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES ('u-lama', 'lama', 'lama@contoh.id', 'x');
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash", "isActive") VALUES ('u-nonaktif', 'nonaktif', NULL, 'x', false);
  `);
  // Baru sekarang skema multi-user dipasang (seperti di produksi: data sudah ada lebih dulu).
  await db.exec(fs.readFileSync(path.join(REPO, "sql/008_multiuser.sql"), "utf8"));
  // Idempoten: menjalankan ulang tidak boleh galat dan tidak mengubah keanggotaan.
  await db.exec(fs.readFileSync(path.join(REPO, "sql/008_multiuser.sql"), "utf8"));
  // Kunci pemilik terakhir (menimpa dua fungsi anggota dari 008); semua uji peran di bawah memakai versi ini.
  await db.exec(fs.readFileSync(path.join(REPO, "sql/020_member_owner_lock.sql"), "utf8"));

  await db.exec(`
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES
      ('u-owner', 'owner', 'owner@contoh.id', 'x'), ('u-admin', 'admin', 'admin@contoh.id', 'x'),
      ('u-editor', 'editor', 'editor@contoh.id', 'x'), ('u-viewer', 'viewer', 'viewer@contoh.id', 'x'),
      ('u-lain', 'lain', 'lain@contoh.id', 'x'), ('u-tanpa', 'tanpa', 'tanpa@contoh.id', 'x');
    DELETE FROM "DashboardMembership";
    INSERT INTO "DashboardMembership" ("userId", "workspaceId", role, "accountScope") VALUES
      ('u-owner', 'ws1', 'OWNER', 'SEMUA'), ('u-admin', 'ws1', 'ADMIN', 'SEMUA'),
      ('u-editor', 'ws1', 'EDITOR', 'PILIHAN'), ('u-viewer', 'ws1', 'VIEWER', 'SEMUA'),
      ('u-lain', 'ws2', 'OWNER', 'SEMUA'), ('u-owner', 'ws2', 'VIEWER', 'SEMUA');
    INSERT INTO "DashboardMemberAccount" VALUES ('u-editor', 'ws1', 'a2');
    UPDATE "DashboardUser" SET "lastWorkspaceId" = 'ws1' WHERE id = 'u-owner';
  `);
  forgetMembership();

  await upsertConfigs(
    ["a1", "a2", "a3"].map((a) => ({ accountId: a, workspaceId: a === "a3" ? "ws2" : "ws1", ...DEFAULT_SETTINGS, mode: "TINJAU" as const })),
    "u-owner",
    new Date()
  );
  await db.exec(
    ["a1", "a2", "a3"]
      .map(
        (a) => `INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, status, draft)
        VALUES ('slot-${a}', '${a === "a3" ? "ws2" : "ws1"}', '${a}', '2099-01-01', 0, '2099-01-01T05:00:00', 12, 'MENUNGGU_TINJAU',
                '{"text":"draf milik ${a} yang menunggu tinjauan","topicTag":null,"angle":"x","rationale":"y","model":"m","chars":30,"checks":[]}');`
      )
      .join("\n")
  );
});

describe("pemasangan pada data yang sudah ada", () => {
  it("pengguna lama yang aktif menjadi Pemilik di tiap workspace; brand diambil dari nama workspace", async () => {
    // Keanggotaan awal sudah diganti di beforeAll; yang diperiksa di sini jejak pemasangannya.
    const brands = await db.query<{ workspaceId: string; namaBrand: string }>(`SELECT "workspaceId", "namaBrand" FROM "WorkspaceSettings" ORDER BY 1`);
    expect(brands.rows).toEqual([
      { workspaceId: "ws1", namaBrand: "Brand Satu" },
      { workspaceId: "ws2", namaBrand: "Brand Dua" },
    ]);
    // Pemasangan ulang di workspace yang sudah punya anggota tidak menambah Pemilik baru.
    expect(await count(`"DashboardMembership" WHERE "userId" = 'u-lama'`)).toBe(0);
    expect(await count(`"DashboardMembership" WHERE "userId" = 'u-nonaktif'`)).toBe(0);
  });

  it("fungsi daftar antrean lama tetap bisa dipanggil tanpa parameter baru", async () => {
    const rows = await db.query<{ r: unknown[] }>(
      `SELECT dash_post_list(p_scope => 'upcoming', p_username => NULL, p_status => NULL, p_cursor_at => NULL, p_cursor_id => NULL,
                             p_include_all => false, p_limit => 20, p_now => '2026-10-13T00:00:00') AS r`
    );
    expect(rows.rows[0].r).toHaveLength(3);
  });
});

describe("lingkup tenant di titik akses data", () => {
  it("akun di luar lingkup diperlakukan sebagai dikecualikan oleh semua pembantu query", async () => {
    await runScoped(makeScope("ws1", null), async () => {
      expect((await accountScope()).visibleIds.sort()).toEqual(["a1", "a2"]);
      expect(await scopedIds()).toEqual(["a1", "a2"]);
      expect(await scopedIds(["a1", "a3"])).toEqual(["a1"]);
      expect(await excludedIdList()).toBe("(a3)");
      expect((await listPublishAccounts()).map((a) => a.id).sort()).toEqual(["a1", "a2"]);
    });
    await runScoped(makeScope("ws1", ["a2"]), async () => {
      expect(await scopedIds()).toEqual(["a2"]);
      expect((await listPublishAccounts()).map((a) => a.id)).toEqual(["a2"]);
    });
    await runScoped(makeScope("ws2", null), async () => {
      // Cache daftar akun sudah hangat dari lingkup ws1: tetap hanya akun ws2 yang keluar.
      expect((await listPublishAccounts()).map((a) => a.id)).toEqual(["a3"]);
      expect(await excludedIdList()).toBe("(a1,a2)");
    });
    // Tanpa lingkup (tick autopilot): semua akun.
    expect(await scopedIds()).toBeUndefined();
    expect((await listPublishAccounts()).map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("kunci cache berbeda per lingkup", () => {
    const keys = [makeScope("ws1", null), makeScope("ws1", ["a2"]), makeScope("ws2", null), makeScope("ws1", ["a1", "a2"]), makeScope("ws1", ["a2", "a1"])].map(
      (s) => runScoped(s, () => scopeKey())
    );
    expect(new Set(keys.slice(0, 3)).size).toBe(3);
    expect(keys[3]).toBe(keys[4]);
    expect(scopeKey()).toBe("*");
  });
});

describe("isolasi lewat route", () => {
  const visibleAccounts = async (user: string) =>
    (await json<{ accounts: { id: string }[] }>(await accountsGET(req(user, "/api/threads/accounts")))).accounts.map((a) => a.id).sort();

  it("tanpa sesi ditolak; tanpa keanggotaan tidak melihat apa pun", async () => {
    expect((await accountsGET(req(null, "/api/threads/accounts"))).status).toBe(401);
    expect(await visibleAccounts("u-tanpa")).toEqual([]);
    const me = await json<{ hasAccess: boolean; role: string }>(await meGET(req("u-tanpa", "/api/auth/me")));
    expect(me).toMatchObject({ hasAccess: false, role: "VIEWER" });
  });

  it("daftar akun, ringkasan autopilot, dan slot mengikuti workspace dan lingkup akun", async () => {
    expect(await visibleAccounts("u-owner")).toEqual(["a1", "a2"]);
    expect(await visibleAccounts("u-editor")).toEqual(["a2"]);
    expect(await visibleAccounts("u-lain")).toEqual(["a3"]);

    const overview = async (user: string) => {
      const o = await json<{ accounts: { id: string }[]; slots: { accountId: string }[]; reviewCount: number }>(
        await overviewGET(req(user, "/api/autopilot/overview"))
      );
      return { accounts: o.accounts.map((a) => a.id).sort() };
    };
    expect((await overview("u-owner")).accounts).toEqual(["a1", "a2"]);
    expect((await overview("u-editor")).accounts).toEqual(["a2"]);
    expect((await overview("u-lain")).accounts).toEqual(["a3"]);

    const review = async (user: string) =>
      (await json<{ items: { accountId: string }[] }>(await slotsGET(req(user, "/api/autopilot/slots?view=review")))).items.map((s) => s.accountId).sort();
    expect(await review("u-owner")).toEqual(["a1", "a2"]);
    expect(await review("u-editor")).toEqual(["a2"]);
    expect(await review("u-lain")).toEqual(["a3"]);
    expect((await slotsGET(req("u-editor", "/api/autopilot/slots?view=review&accountId=a1"))).status).toBe(404);
  });

  it("antrean posting: daftar, polling id, edit, dan batal hanya untuk akun dalam lingkup", async () => {
    const list = async (user: string) =>
      (await json<{ items: { id: string }[] }>(await postsGET(req(user, "/api/content/posts?scope=upcoming")))).items.map((p) => p.id).sort();
    expect(await list("u-owner")).toEqual(["post-a1", "post-a2"]);
    expect(await list("u-editor")).toEqual(["post-a2"]);
    expect(await list("u-lain")).toEqual(["post-a3"]);

    const byIds = async (user: string) =>
      (await json<{ items: { id: string }[] }>(await postsGET(req(user, "/api/content/posts?ids=post-a1,post-a2,post-a3")))).items.map((p) => p.id).sort();
    expect(await byIds("u-lain")).toEqual(["post-a3"]);
    expect(await byIds("u-editor")).toEqual(["post-a2"]);

    // Workspace lain dan akun di luar lingkup: seperti tidak ada (404), bukan "dilarang".
    expect((await postPATCH(req("u-lain", "/api/content/posts/post-a1", "PATCH", { text: "dibajak dari workspace lain ya" }), param("post-a1"))).status).toBe(404);
    expect((await postDELETE(req("u-lain", "/api/content/posts/post-a1", "DELETE"), param("post-a1"))).status).toBe(404);
    expect((await postDELETE(req("u-editor", "/api/content/posts/post-a1", "DELETE"), param("post-a1"))).status).toBe(404);
    // Pengamat tidak boleh mengubah apa pun, juga di workspace-nya sendiri.
    expect((await postDELETE(req("u-viewer", "/api/content/posts/post-a1", "DELETE"), param("post-a1"))).status).toBe(403);
    expect((await postsPOST(req("u-viewer", "/api/content/posts", "POST", {}))).status).toBe(403);
    expect(await count(`"ScheduledPost" WHERE caption LIKE 'antrean milik%'`)).toBe(3);

    // Membuat posting ke akun workspace lain: akunnya "tidak ditemukan".
    const res = await postsPOST(
      req("u-lain", "/api/content/posts", "POST", {
        idempotencyKey: "kunci-uji-lintas-workspace",
        items: [{ threadsAccountId: "a1", text: "mencoba posting ke akun workspace lain, harus gagal", topicTag: null, publishAt: "now", aiModel: null, aiEdited: false }],
      })
    );
    expect(res.status).toBe(400);
    expect(await count(`"ScheduledPost" WHERE "workspaceId" = 'ws1'`)).toBe(2);
  });

  it("pengaturan autopilot dan tindakan slot tidak bisa menyentuh workspace atau akun lain", async () => {
    const put = (user: string, account: string) =>
      autopilotAccountPUT(req(user, `/api/autopilot/accounts/${account}`, "PUT", { mode: "MATI" }), param(account));
    expect((await put("u-lain", "a1")).status).toBe(404);
    expect((await put("u-editor", "a1")).status).toBe(404);
    expect((await put("u-viewer", "a1")).status).toBe(403);
    const modes = await db.query<{ mode: string }>(`SELECT mode FROM "AutopilotConfig"`);
    expect(modes.rows.every((r) => r.mode === "TINJAU")).toBe(true);

    const act = (user: string, slot: string, action: string) => slotPOST(req(user, `/api/autopilot/slots/${slot}`, "POST", { action }), param(slot));
    expect((await act("u-lain", "slot-a1", "reject")).status).toBe(409);
    expect((await act("u-lain", "slot-a1", "approve")).status).toBe(404);
    expect((await act("u-viewer", "slot-a1", "reject")).status).toBe(403);
    expect(await count(`"AutopilotSlot" WHERE status = 'MENUNGGU_TINJAU'`)).toBe(3);

    // Dalam lingkupnya sendiri tindakan berjalan.
    expect((await act("u-editor", "slot-a2", "reject")).status).toBe(200);
    expect(await updateSlot("slot-a2", { from: ["DILEWATI"], to: "MENUNGGU_TINJAU" }, new Date())).toBe(true);
  });

  it("pindah workspace hanya ke workspace tempat pengguna menjadi anggota", async () => {
    expect((await mePOST(req("u-admin", "/api/auth/me", "POST", { action: "workspace", workspaceId: "ws2" }))).status).toBe(404);
    expect((await mePOST(req("u-owner", "/api/auth/me", "POST", { action: "workspace", workspaceId: "ws2" }))).status).toBe(200);
    // Di ws2 pengguna ini hanya Pengamat: melihat akun ws2, tidak bisa mengubah.
    expect(await visibleAccounts("u-owner")).toEqual(["a3"]);
    expect((await autopilotAccountPUT(req("u-owner", "/api/autopilot/accounts/a3", "PUT", { mode: "MATI" }), param("a3"))).status).toBe(403);
    expect((await mePOST(req("u-owner", "/api/auth/me", "POST", { action: "workspace", workspaceId: "ws1" }))).status).toBe(200);
    expect(await visibleAccounts("u-owner")).toEqual(["a1", "a2"]);
  });
});

describe("tim: peran, undangan, reset password", () => {
  it("daftar tim dan audit hanya untuk Admin ke atas, dan hanya workspace sendiri", async () => {
    expect((await teamGET(req("u-editor", "/api/team"))).status).toBe(403);
    expect((await auditGET(req("u-editor", "/api/audit"))).status).toBe(403);
    const team = await json<{ members: { id: string; role: string; accountIds: string[] }[] }>(await teamGET(req("u-admin", "/api/team")));
    expect(team.members.map((m) => m.id)).toEqual(["u-owner", "u-admin", "u-editor", "u-viewer"]);
    expect(team.members.find((m) => m.id === "u-editor")).toMatchObject({ role: "EDITOR", accountIds: ["a2"] });
    const other = await json<{ members: { id: string }[] }>(await teamGET(req("u-lain", "/api/team")));
    expect(other.members.map((m) => m.id).sort()).toEqual(["u-lain", "u-owner"]);
  });

  it("perubahan peran: Admin tidak bisa mengatur Pemilik, Pemilik terakhir terlindungi, lingkup akun divalidasi", async () => {
    const patch = (user: string, target: string, body: unknown) => memberPATCH(req(user, `/api/team/members/${target}`, "PATCH", body), param(target));
    expect((await patch("u-admin", "u-owner", { role: "VIEWER" })).status).toBe(403);
    expect((await patch("u-admin", "u-viewer", { role: "OWNER" })).status).toBe(403);
    expect((await patch("u-owner", "u-owner", { role: "ADMIN" })).status).toBe(409);
    expect((await memberDELETE(req("u-owner", "/api/team/members/u-owner", "DELETE"), param("u-owner"))).status).toBe(409);
    // Anggota workspace lain tidak bisa diubah dari sini; akun workspace lain tidak bisa dijadikan lingkup.
    expect((await patch("u-admin", "u-lain", { role: "VIEWER" })).status).toBe(404);
    expect((await patch("u-admin", "u-viewer", { role: "EDITOR", accountIds: ["a3"] })).status).toBe(404);

    expect((await patch("u-admin", "u-viewer", { role: "EDITOR", accountIds: ["a1"] })).status).toBe(200);
    const scope = await db.query<{ role: string; accountScope: string }>(`SELECT role, "accountScope" FROM "DashboardMembership" WHERE "userId" = 'u-viewer' AND "workspaceId" = 'ws1'`);
    expect(scope.rows[0]).toEqual({ role: "EDITOR", accountScope: "PILIHAN" });
    // Perubahan langsung berlaku (cache keanggotaan target dibuang).
    const accounts = await json<{ accounts: { id: string }[] }>(await accountsGET(req("u-viewer", "/api/threads/accounts")));
    expect(accounts.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect((await patch("u-admin", "u-viewer", { role: "VIEWER" })).status).toBe(200);
    expect(await count(`"DashboardAuditLog" WHERE action = 'ANGGOTA_UBAH' AND target = 'u-viewer'`)).toBe(2);
  });

  let invitePath = "";
  it("undangan: tautan sekali tampil, hanya hash yang tersimpan, diterima sekali dengan password", async () => {
    expect((await teamPOST(req("u-editor", "/api/team", "POST", { email: "baru@contoh.id", role: "EDITOR" }))).status).toBe(403);
    expect((await teamPOST(req("u-admin", "/api/team", "POST", { email: "bukan-email", role: "EDITOR" }))).status).toBe(400);
    expect((await teamPOST(req("u-admin", "/api/team", "POST", { email: "baru@contoh.id", role: "OWNER" }))).status).toBe(400);

    const made = await json<{ path: string; invite: { id: string; email: string; role: string; accountIds: string[]; expired: boolean } }>(
      await teamPOST(req("u-admin", "/api/team", "POST", { email: "Baru@Contoh.id", role: "EDITOR", accountIds: ["a2"] }))
    );
    invitePath = made.path;
    const token = invitePath.split("/").pop()!;
    // Balasan memuat baris undangan (untuk daftar di layar) tetapi tidak pernah memuat hash token.
    expect(made.invite).toMatchObject({ email: "baru@contoh.id", role: "EDITOR", accountIds: ["a2"], expired: false });
    expect(await count(`"DashboardInvite" WHERE id = '${made.invite.id}'`)).toBe(1);
    expect(JSON.stringify(made.invite)).not.toContain(hashToken(token));
    const stored = await db.query<{ tokenHash: string; email: string; accountIds: string[] }>(`SELECT "tokenHash", email, "accountIds" FROM "DashboardInvite"`);
    expect(stored.rows).toEqual([{ tokenHash: hashToken(token), email: "baru@contoh.id", accountIds: ["a2"] }]);
    expect(JSON.stringify(stored.rows)).not.toContain(token);

    const peek = await json<{ invite: { email: string; workspace: string; hasAccount: boolean } }>(await inviteGET(req(null, `/api/auth/invite?token=${token}`)));
    expect(peek.invite).toMatchObject({ email: "baru@contoh.id", workspace: "Brand Satu", hasAccount: false });
    expect((await inviteGET(req(null, "/api/auth/invite?token=" + "x".repeat(43)))).status).toBe(404);

    expect((await invitePOST(req(null, "/api/auth/invite", "POST", { token, username: "baru", password: "pendek" }))).status).toBe(400);
    expect((await invitePOST(req(null, "/api/auth/invite", "POST", { token, username: "owner", password: "password-yang-panjang" }))).status).toBe(409);
    const accepted = await invitePOST(req(null, "/api/auth/invite", "POST", { token, username: "baru", name: "Orang Baru", password: "password-yang-panjang" }));
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("set-cookie")).toMatch(/^session=/);
    const user = await db.query<{ id: string; email: string; passwordHash: string }>(`SELECT id, email, "passwordHash" FROM "DashboardUser" WHERE username = 'baru'`);
    expect(user.rows[0].email).toBe("baru@contoh.id");
    expect(user.rows[0].passwordHash).toMatch(/^scrypt:/);
    const member = await db.query<{ role: string; accountScope: string }>(`SELECT role, "accountScope" FROM "DashboardMembership" WHERE "userId" = $1`, [user.rows[0].id]);
    expect(member.rows).toEqual([{ role: "EDITOR", accountScope: "PILIHAN" }]);
    expect(await count(`"DashboardMemberAccount" WHERE "userId" = '${user.rows[0].id}' AND "accountId" = 'a2'`)).toBe(1);

    // Sekali pakai.
    expect((await invitePOST(req(null, "/api/auth/invite", "POST", { token, username: "baru2", password: "password-yang-panjang" }))).status).toBe(404);
  });

  it("undangan tidak bisa dipakai untuk mengubah peran anggota yang sudah ada", async () => {
    const made = await json<{ path: string }>(await teamPOST(req("u-admin", "/api/team", "POST", { email: "owner@contoh.id", role: "VIEWER" })));
    const token = made.path.split("/").pop()!;
    const res = await invitePOST(req(null, "/api/auth/invite", "POST", { token }));
    expect(res.status).toBe(200);
    // Akun lama tidak dibuatkan sesi hanya karena memegang tautan undangan.
    expect(res.headers.get("set-cookie")).toBeNull();
    const role = await db.query<{ role: string }>(`SELECT role FROM "DashboardMembership" WHERE "userId" = 'u-owner' AND "workspaceId" = 'ws1'`);
    expect(role.rows[0].role).toBe("OWNER");
  });

  it("reset password: tautan dari Admin untuk anggotanya, sekali pakai, password lemah ditolak", async () => {
    expect((await memberResetPOST(req("u-admin", "/api/team/members/u-lain", "POST"), param("u-lain"))).status).toBe(404);
    const made = await json<{ path: string }>(await memberResetPOST(req("u-admin", "/api/team/members/u-editor", "POST"), param("u-editor")));
    const token = made.path.split("/").pop()!;
    expect((await resetPOST(req(null, "/api/auth/reset", "POST", { token, password: "pendek" }))).status).toBe(400);
    expect((await resetPOST(req(null, "/api/auth/reset", "POST", { token, password: "password-baru-yang-panjang" }))).status).toBe(200);
    const hash = await db.query<{ passwordHash: string }>(`SELECT "passwordHash" FROM "DashboardUser" WHERE id = 'u-editor'`);
    expect(hash.rows[0].passwordHash).toMatch(/^scrypt:/);
    expect((await resetPOST(req(null, "/api/auth/reset", "POST", { token, password: "password-lain-yang-panjang" }))).status).toBe(404);
    expect(await count(`"DashboardAuditLog" WHERE action = 'RESET_PASSWORD_BUAT' AND target = 'u-editor'`)).toBe(1);
  });

  it("pengaturan workspace: semua anggota membaca, hanya Admin ke atas yang mengubah", async () => {
    const before = await json<{ namaBrand: string; canEdit: boolean }>(await settingsGET(req("u-editor", "/api/workspace/settings")));
    expect(before).toMatchObject({ namaBrand: "Brand Satu", canEdit: false });
    const body = { namaBrand: "Brand Satu Baru", deskripsiBrand: "kuliner <b>cepat saji</b>", topikTerlarang: ["Kompetitor Sebelah", "ab", "kompetitor sebelah"] };
    expect((await settingsPUT(req("u-editor", "/api/workspace/settings", "PUT", body))).status).toBe(403);
    const saved = await settingsPUT(req("u-admin", "/api/workspace/settings", "PUT", body));
    expect(saved.status).toBe(200);
    // Balasan simpan = nilai yang tersimpan (sudah dirapikan), sama dengan yang dibaca ulang di bawah.
    expect((await json<{ settings: unknown }>(saved)).settings).toEqual({
      namaBrand: "Brand Satu Baru",
      deskripsiBrand: "kuliner b cepat saji /b",
      topikTerlarang: ["kompetitor sebelah"],
    });
    const after = await json<{ namaBrand: string; deskripsiBrand: string; topikTerlarang: string[] }>(await settingsGET(req("u-admin", "/api/workspace/settings")));
    expect(after).toMatchObject({ namaBrand: "Brand Satu Baru", deskripsiBrand: "kuliner b cepat saji /b", topikTerlarang: ["kompetitor sebelah"] });
    // Workspace lain tidak terpengaruh.
    expect(await json<{ namaBrand: string }>(await settingsGET(req("u-lain", "/api/workspace/settings")))).toMatchObject({ namaBrand: "Brand Dua" });
  });

  it("anggota yang dikeluarkan langsung kehilangan akses", async () => {
    expect((await memberDELETE(req("u-admin", "/api/team/members/u-viewer", "DELETE"), param("u-viewer"))).status).toBe(200);
    const accounts = await json<{ accounts: unknown[] }>(await accountsGET(req("u-viewer", "/api/threads/accounts")));
    expect(accounts.accounts).toEqual([]);
    const audit = await json<{ items: { action: string; actorName: string | null }[] }>(await auditGET(req("u-owner", "/api/audit")));
    expect(audit.items.map((a) => a.action)).toEqual(expect.arrayContaining(["ANGGOTA_KELUAR", "UNDANGAN_BUAT", "UNDANGAN_TERIMA", "PENGATURAN_WORKSPACE"]));
    expect(audit.items.find((a) => a.action === "ANGGOTA_KELUAR")?.actorName).toBe("admin");
    // Audit workspace lain tidak tercampur.
    const other = await json<{ items: { action: string }[] }>(await auditGET(req("u-lain", "/api/audit")));
    expect(other.items.some((a) => a.action === "ANGGOTA_KELUAR")).toBe(false);
  });
});
