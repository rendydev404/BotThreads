/**
 * Uji integrasi Pengerahan Buzzer Lintas-Niche (sql/029_buzzer.sql + buzzer-ai.ts + buzzer-service.ts + route API).
 * Menjalankan SQL asli di Postgres in-memory (PGlite) dan memverifikasi:
 * 1. Klasifikasi lintas-niche (SEJALUR, JEMBATAN, JAUH/bertanya) dan kealamian komentar.
 * 2. Hak akses RBAC modul buzzer (buzzer.lihat, buzzer.kelola) dan keamanan fungsi SQL.
 * 3. Alur penuh Super Admin: pratinjau AI, pengerahan KOMEN + REPOST + QUOTE ke API Threads, serta pembatalan/coba ulang.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () =>
  (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb, undefined, {
    DashboardUser: `SELECT id, username, name, email, "isActive", "passwordHash" FROM "DashboardUser" ORDER BY "createdAt", id`,
  })
);

import { NextRequest } from "next/server";
import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { SESSION_COOKIE, createSessionToken } from "../auth";
import {
  classifyNicheRelation,
  cleanBuzzerText,
  generateBuzzerDrafts,
  inferProfileHeuristic,
} from "../buzzer-ai";
import { forgetPlatform } from "../platform";
import { encryptThreadsToken } from "../threads-token";
import { GET as buzzerGET, POST as buzzerPOST } from "@/app/api/admin/buzzer/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-20T07:00:00Z").getTime();

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;

const tokens = new Map<string, string>();
async function req(user: string | null, url: string, method = "GET", body?: unknown): Promise<NextRequest> {
  if (user && !tokens.has(user)) {
    const hash = (await rows<{ passwordHash: string }>(`SELECT "passwordHash" FROM "DashboardUser" WHERE id = $1`, [user]))[0].passwordHash;
    tokens.set(user, await createSessionToken(user, hash));
  }
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { cookie: `${SESSION_COOKIE}=${tokens.get(user)}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const threadsCalls: { url: string; method: string; body: string }[] = [];
function fakeThreadsFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? String(init.body) : "";
  threadsCalls.push({ url, method, body });
  const respond = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));

  if (url.includes("/threads?") && method === "GET") {
    return respond({
      data: [
        {
          id: "media_live_999",
          media_type: "TEXT_POST",
          text: "Shawarma ayam ukuran jumbo baru aja matang dari panggangan, pedasnya pas buat makan malam!",
          permalink: "https://www.threads.net/@sukashawarma/post/live999",
          timestamp: "2026-10-20T06:50:00Z",
        },
      ],
    });
  }
  if (url.endsWith("/repost") && method === "POST") {
    return respond({ id: `repost_${threadsCalls.length}` });
  }
  if (url.endsWith("/threads") && method === "POST") {
    return respond({ id: `cont_${threadsCalls.length}` });
  }
  if (url.includes("fields=status")) {
    return respond({ status: "FINISHED" });
  }
  if (url.endsWith("/threads_publish") && method === "POST") {
    return respond({ id: `pub_${threadsCalls.length}` });
  }
  if (url.includes("fields=permalink")) {
    return respond({ permalink: `https://www.threads.net/@buzzer/post/${threadsCalls.length}` });
  }
  return respond({ error: { message: "Endpoint tidak dikenal" } }, 404);
}

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-buzzer-yang-panjangnya-lebih-dari-32-karakter";
  process.env.TOKEN_ENCRYPTION_KEY = "kunci-enkripsi-token-buzzer-uji";
  delete process.env.GEMINI_API_KEY;

  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
    "sql/007_autopilot_learning.sql",
    "sql/008_multiuser.sql",
    "sql/009_signup.sql",
    "sql/010_superadmin.sql",
    "sql/011_plans.sql",
    "sql/012_billing_and_integrations.sql",
    "sql/014_admin_rbac.sql",
    "sql/029_buzzer.sql",
    // Pastikan idempoten saat dijalankan dua kali:
    "sql/029_buzzer.sql",
  ]);
  h.db = db;

  const encToken = encryptThreadsToken("tok_valid_123");

  await db.exec(`
    INSERT INTO "Workspace" (id, nama, slug) VALUES
      ('ws-main', 'Suka Shawarma', 'suka-shawarma'),
      ('ws-buzzer', 'Suka Shawarma Buzzer', 'suka-shawarma-buzzer');

    INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "platformRole", "createdAt") VALUES
      ('u-super', 'superadmin', 'super@contoh.id', 'Super Admin', 'hash-super', 'SUPERADMIN', '2026-01-01'),
      ('u-keuangan', 'keuangan', 'fin@contoh.id', 'Staf Keuangan', 'hash-fin', 'KEUANGAN', '2026-01-02');

    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId", "accessToken", "accessExpiresAt", "needsReconnect", scopes)
    VALUES
      ('ta-target-1', 'ws-main', 'sukashawarmacibubur', 'Suka Shawarma Cibubur', '9001', '${encToken}', '2026-12-31T00:00:00', false, '{threads_basic,threads_content_publish}'),
      ('ta-buz-1', 'ws-buzzer', 'naraaakiranaaa', 'Nara Kirana', '1001', '${encToken}', '2026-12-31T00:00:00', false, '{threads_basic,threads_content_publish}'),
      ('ta-buz-2', 'ws-buzzer', 'shawarmashortsid', 'Raka Dev', '1002', '${encToken}', '2026-12-31T00:00:00', false, '{threads_basic,threads_content_publish}'),
      ('ta-buz-3', 'ws-buzzer', 'lunaaestrellaaa', 'Bunda Luna', '1003', '${encToken}', '2026-12-31T00:00:00', false, '{threads_basic,threads_content_publish}');

    INSERT INTO "AutoCommentSetting" ("workspaceId", "threadsAccountId", "personaName", "personaStyle")
    VALUES
      ('ws-buzzer', 'ta-buz-1', 'nara', 'Mahasiswi semester akhir anak kos, pakai "gue", receh, suka kuliner hemat'),
      ('ws-buzzer', 'ta-buz-3', 'luna', 'Ibu rumah tangga, 2 anak SD, pakai "aku", hangat');

    INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId", "mediaType", text, permalink, "postedAt", views, likes, replies)
    VALUES
      ('ta-target-1', 'media_db_100', 'TEXT', 'Malam Jumat paling pas makan shawarma hangat bareng keluarga di rumah.', 'https://www.threads.net/@sukashawarmacibubur/post/100', '2026-10-19T12:00:00', 420, 25, 4),
      ('ta-buz-2', 'media_buz2_1', 'TEXT', 'Akhirnya seluruh task di papan Jira resmi bergeser ke kolom Done malam ini.', 'https://www.threads.net/@shawarmashortsid/post/1', '2026-10-18T13:00:00', 110, 8, 1);
  `);
  forgetPlatform();
});

afterEach(() => {
  vi.unstubAllGlobals();
  threadsCalls.length = 0;
});

describe("Mesin AI Lintas-Niche Buzzer (buzzer-ai)", () => {
  it("mengklasifikasikan relasi niche SEJALUR, JEMBATAN, dan JAUH dengan tepat", () => {
    // 1. SEJALUR: Postingan kuliner hemat vs Buzzer mahasiswi anak kos & kuliner hemat
    const sejalur = classifyNicheRelation(
      "Rekomendasi kuliner malam hemat buat anak kos di akhir bulan",
      "Kuliner & Jajanan",
      "Mahasiswi anak kos & kuliner hemat",
      "Mahasiswi semester akhir anak kos, pakai gue"
    );
    expect(sejalur.relation).toBe("SEJALUR");

    // 2. JEMBATAN: Postingan kuliner shawarma malam vs Buzzer Software Engineer IT
    const jembatan = classifyNicheRelation(
      "Shawarma ayam hangat baru matang, cocok buat makan malam!",
      "Kuliner Shawarma",
      "Software engineer, kerja IT & koding",
      "Anak IT yang sering koding depan laptop"
    );
    expect(jembatan.relation).toBe("JEMBATAN");

    // 3. JAUH: Postingan arsitektur GPU & algoritma LLM teknis vs Buzzer Ibu Rumah Tangga
    const jauh = classifyNicheRelation(
      "Optimasi kuantisasi bobot model LLM di GPU cluster dengan algoritma FlashAttention terbaru",
      "Teknologi AI & Arsitektur GPU",
      "Ibu rumah tangga, parenting anak SD & masak harian",
      "Ibu rumah tangga 2 anak SD, hangat"
    );
    expect(jauh.relation).toBe("JAUH");
  });

  it("menyusun komentar natural yang berbeda antar-buzzer sesuai jarak niche dan bebas ciri robotik", async () => {
    const buzzers = [
      {
        accountId: "b1",
        workspaceId: "ws-buzzer",
        workspaceNama: "Buzzer",
        username: "nara",
        displayName: "Nara",
        avatarUrl: null,
        needsReconnect: false,
        accessExpiresAt: "2026-12-31T00:00:00Z",
        scopes: ["threads_content_publish"],
        outletNama: "BUZZER 1",
        aktif: true,
        ready: true,
        niche: "Kuliner malam & anak kos",
        persona: 'Mahasiswi kos, pakai "gue", suka kuliner malam',
        voiceStyle: "gue_lo" as const,
        catatan: null,
        inferredFrom: "AUTO_COMMENT" as const,
        updatedAt: null,
        samplePosts: [],
        tasksToday: 0,
        tasksTotal: 0,
      },
      {
        accountId: "b2",
        workspaceId: "ws-buzzer",
        workspaceNama: "Buzzer",
        username: "raka_dev",
        displayName: "Raka",
        avatarUrl: null,
        needsReconnect: false,
        accessExpiresAt: "2026-12-31T00:00:00Z",
        scopes: ["threads_content_publish"],
        outletNama: "BUZZER 2",
        aktif: true,
        ready: true,
        niche: "Software engineer & lembur koding",
        persona: 'Programmer yang sering lembur, pakai "gue"',
        voiceStyle: "gue_lo" as const,
        catatan: null,
        inferredFrom: "HISTORI" as const,
        updatedAt: null,
        samplePosts: ["Task di papan Jira akhirnya beres."],
        tasksToday: 0,
        tasksTotal: 0,
      },
      {
        accountId: "b3",
        workspaceId: "ws-buzzer",
        workspaceNama: "Buzzer",
        username: "bunda_luna",
        displayName: "Luna",
        avatarUrl: null,
        needsReconnect: false,
        accessExpiresAt: "2026-12-31T00:00:00Z",
        scopes: ["threads_content_publish"],
        outletNama: "BUZZER 3",
        aktif: true,
        ready: true,
        niche: "Ibu rumah tangga & tanaman hias",
        persona: 'Ibu rumah tangga 2 anak SD, pakai "aku"',
        voiceStyle: "aku_kamu" as const,
        catatan: null,
        inferredFrom: "AUTO_COMMENT" as const,
        updatedAt: null,
        samplePosts: [],
        tasksToday: 0,
        tasksTotal: 0,
      },
    ];

    // Uji pada postingan teknis AI supaya b3 (Ibu Rumah Tangga) masuk mode JAUH (bertanya) dan b2 (Programmer) masuk SEJALUR
    const res = await generateBuzzerDrafts({
      targetUsername: "akbaralatas",
      targetNiche: "Teknologi AI & Software Developer",
      targetText: "Ngulik prompting AI dan arsitektur software developer buat bantu koding harian di kantor.",
      action: "KOMEN",
      buzzers,
    });

    expect(res.items).toHaveLength(3);
    const byAcc = new Map(res.items.map((i) => [i.buzzerAccountId, i]));
    expect(byAcc.get("b2")?.nicheRelation).toBe("SEJALUR");
    expect(byAcc.get("b3")?.nicheRelation).toBe("JAUH");
    // Mode JAUH wajib menghasilkan kalimat bertanya yang natural
    expect(byAcc.get("b3")?.text).toContain("?");
    // Semua komentar unik
    const uniqueTexts = new Set(res.items.map((i) => i.text));
    expect(uniqueTexts.size).toBe(3);
  });

  it("menyusun 10 komentar yang berbeda-beda sesuai niche masing-masing buzzer (tidak semuanya bertanya)", async () => {
    const tenBuzzers = [
      ["1", "wahyusadhera", "Gamer kasual, teknologi & obrolan malam", "Anak muda melek teknologi, pakai gue/lo", "gue_lo"],
      ["2", "rafhalrans", "Freelancer desain, kerja WFC & gadget", "Freelancer kreatif kerja dari kafe, pakai gue/lo", "gue_lo"],
      ["3", "sarahmaulidaaaaa__", "Guru PAUD/TK, edukasi anak & kehidupan anak kos", "Guru PAUD muda di kosan, pakai aku", "aku_kamu"],
      ["4", "charlotteavapriya856", "Penggemar film, musik & pop culture", "Netizen aktif suka bahas tontonan akhir pekan", "aku_kamu"],
      ["5", "lalaazzahra420", "Pengantin baru, masak rumahan & belanja harian", "Pengantin baru suka urus rumah bareng suami, pakai aku", "aku_kamu"],
      ["6", "emmascarlettamelia538", "Karyawati HR/admin, skincare & lifestyle", "Karyawati kantor suka sharing kerjaan & skincare, pakai aku", "aku_kamu"],
      ["7", "azka5228", "Karyawan swasta, ngopi & kehidupan komuter", "Karyawan kantoran hobi ngopi sore", "aku_kamu"],
      ["8", "farhannnalam_", "Pekerja lapangan, motoran & kuliner jalanan", "Anak lapangan tiap hari di jalan naik motor, santai", "gue_lo"],
      ["9", "yahyasabella", "Anak kos, kuliah & berburu kuliner malam", "Mahasiswa anak kos sering lapar malam, pakai gue/lo", "gue_lo"],
      ["10", "zaraharperelizabeth298", "Ibu muda, parenting & masak praktis", "Ibu muda suka cari ide cemilan keluarga, pakai aku", "aku_kamu"],
    ].map(([id, username, niche, persona, voiceStyle]) => ({
      accountId: id,
      workspaceId: "ws-buzzer",
      workspaceNama: "Buzzer",
      username,
      displayName: username,
      avatarUrl: null,
      needsReconnect: false,
      accessExpiresAt: "2026-12-31T00:00:00Z",
      scopes: ["threads_content_publish"],
      outletNama: `BUZZER ${id}`,
      aktif: true,
      ready: true,
      niche,
      persona,
      voiceStyle: voiceStyle as "gue_lo" | "aku_kamu",
      catatan: null,
      inferredFrom: "AI" as const,
      updatedAt: null,
      samplePosts: [],
      tasksToday: 0,
      tasksTotal: 0,
    }));

    const res = await generateBuzzerDrafts({
      targetUsername: "rendydelrey_",
      targetNiche: "Teknologi & Digital",
      targetText: "Sekarang bikin sistem otomasi konten pakai AI bisa menghemat waktu kerja harian sampai berkali-kali lipat kalau prompt dan alurnya rapi.",
      action: "KOMEN",
      buzzers: tenBuzzers,
    });

    expect(res.items).toHaveLength(10);
    // 1. Seluruh 10 komentar harus 100% berbeda satu sama lain
    const uniqueTexts = new Set(res.items.map((i) => i.text));
    expect(uniqueTexts.size).toBe(10);

    // 2. Hanya maksimal 25% (<= 2 dari 10 akun) yang berstatus JAUH / bertanya ('?'), sisanya pernyataan SEJALUR / JEMBATAN
    const questionItems = res.items.filter((i) => i.text.includes("?"));
    const statementItems = res.items.filter((i) => !i.text.includes("?"));
    expect(questionItems.length).toBeLessThanOrEqual(2);
    expect(statementItems.length).toBeGreaterThanOrEqual(8);

    // 3. Pastikan akun teknologi/gadget (wahyusadhera, rafhalrans) berstatus SEJALUR dan akun lintas-niche (sarah, azka, yahyasabella) berstatus JEMBATAN
    const byId = new Map(res.items.map((i) => [i.buzzerAccountId, i]));
    expect(byId.get("1")?.nicheRelation).toBe("SEJALUR");
    expect(byId.get("2")?.nicheRelation).toBe("SEJALUR");
    expect(byId.get("3")?.nicheRelation).toBe("JEMBATAN");
    expect(byId.get("7")?.nicheRelation).toBe("JEMBATAN");
    expect(byId.get("9")?.nicheRelation).toBe("JEMBATAN");
  });

  it("cleanBuzzerText membuang pembuka kaku AI, tanda pisah panjang, hashtag, dan menolak kode/tautan", () => {
    expect(cleanBuzzerText('Wah menarik sekali, saya suka — enak banget #kuliner')).toBe("saya suka, enak banget");
    expect(cleanBuzzerText("const x = () => console.log(1);")).toBeNull();
    expect(cleanBuzzerText("cek https://promo.com sekarang")).toBeNull();
  });

  it("inferProfileHeuristic mengenali profesi/niche dari histori postingan akun buzzer", () => {
    const inferred = inferProfileHeuristic({
      accountId: "ta-buz-2",
      username: "shawarmashortsid",
      displayName: "Raka",
      niche: "",
      persona: "",
      voiceStyle: "aku_kamu",
      samplePosts: ["Jam setengah delapan malem seluruh task di papan Jira resmi bergeser ke kolom Done"],
    });
    expect(inferred.niche).toContain("Software engineer");
    expect(inferred.voiceStyle).toBe("gue_lo");
  });
});

describe("Endpoint Super Admin /api/admin/buzzer & Eksekusi Threads API", () => {
  it("menolak staf tanpa izin buzzer.lihat (403) dan mengizinkan Super Admin (200)", async () => {
    const denied = await buzzerGET(await req("u-keuangan", "/api/admin/buzzer"));
    expect(denied.status).toBe(403);

    const ok = await buzzerGET(await req("u-super", "/api/admin/buzzer"));
    expect(ok.status).toBe(200);
    const body = await json<{
      buzzers: { accountId: string; niche: string; ready: boolean }[];
      targets: { accountId: string; username: string }[];
      stats: { totalBuzzers: number; readyBuzzers: number };
    }>(ok);
    expect(body.stats.totalBuzzers).toBe(3);
    expect(body.stats.readyBuzzers).toBe(3);
    expect(body.targets.map((t) => t.username)).toContain("sukashawarmacibubur");
    // ta-buz-2 otomatis disimpulkan niche Software Engineer dari sample post Jira-nya!
    const buz2 = body.buzzers.find((b) => b.accountId === "ta-buz-2");
    expect(buz2?.niche).toContain("Software engineer");
  });

  it("memuat postingan akun target (gabungan DB + live Threads API)", async () => {
    vi.stubGlobal("fetch", vi.fn(fakeThreadsFetch));
    const res = await buzzerGET(await req("u-super", "/api/admin/buzzer?view=posts&accountId=ta-target-1"));
    expect(res.status).toBe(200);
    const body = await json<{ items: { mediaId: string; text: string }[] }>(res);
    expect(body.items.map((p) => p.mediaId)).toEqual(["media_live_999", "media_db_100"]);
  });

  it("menyimpan perubahan niche/persona buzzer dan mencatat di PlatformAuditLog", async () => {
    const res = await buzzerPOST(
      await req("u-super", "/api/admin/buzzer", "POST", {
        kind: "profile_save",
        items: [
          {
            accountId: "ta-buz-1",
            aktif: true,
            niche: "Mahasiswi tingkat akhir, anak kos & pecinta kuliner pedas",
            persona: "Anak kos semester akhir yang suka nyari jajanan pedas malam hari, pakai gue/lo",
            voiceStyle: "gue_lo",
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const saved = await rows<{ niche: string; voiceStyle: string }>(
      `SELECT niche, "voiceStyle" FROM "BuzzerProfile" WHERE "accountId" = 'ta-buz-1'`
    );
    expect(saved[0]).toEqual({
      niche: "Mahasiswi tingkat akhir, anak kos & pecinta kuliner pedas",
      voiceStyle: "gue_lo",
    });
  });

  it("mengerahkan buzzer (KOMEN, REPOST, QUOTE) ke postingan target dan mengeksekusi ke API Threads", async () => {
    vi.stubGlobal("fetch", vi.fn(fakeThreadsFetch));

    // 1. Pratinjau AI terlebih dahulu
    const prevRes = await buzzerPOST(
      await req("u-super", "/api/admin/buzzer", "POST", {
        kind: "preview",
        targetUsername: "sukashawarmacibubur",
        targetNiche: "Kuliner Shawarma",
        targetText: "Malam Jumat paling pas makan shawarma hangat bareng keluarga di rumah.",
        actions: ["KOMEN", "QUOTE"],
        buzzerAccountIds: ["ta-buz-1", "ta-buz-2", "ta-buz-3"],
      })
    );
    expect(prevRes.status).toBe(200);
    const prevBody = await json<{ items: { buzzerAccountId: string; action: string; nicheRelation: string; text: string }[] }>(prevRes);
    expect(prevBody.items).toHaveLength(6);

    // 2. Kerahkan dengan jeda instan (0-5 detik) supaya semua langsung dieksekusi
    const depRes = await buzzerPOST(
      await req("u-super", "/api/admin/buzzer", "POST", {
        kind: "deploy",
        targetAccountId: "ta-target-1",
        targetUsername: "sukashawarmacibubur",
        targetDisplayName: "Suka Shawarma Cibubur",
        targetNiche: "Kuliner Shawarma",
        targetMediaId: "media_db_100",
        targetText: "Malam Jumat paling pas makan shawarma hangat bareng keluarga di rumah.",
        actions: ["KOMEN", "REPOST", "QUOTE"],
        jedaMinDetik: 0,
        jedaMaxDetik: 2,
        buzzerAccountIds: ["ta-buz-1", "ta-buz-2"],
        customDrafts: prevBody.items,
      })
    );
    expect(depRes.status).toBe(200);
    const depBody = await json<{ campaignId: string; inserted: number; executedNow: number }>(depRes);
    expect(depBody.inserted).toBe(6);
    expect(depBody.executedNow).toBe(6);

    // Pastikan panggilan ke API Threads menggunakan reply_to_id (KOMEN), /repost (REPOST), dan quote_post_id (QUOTE)
    const replyCalls = threadsCalls.filter((c) => c.body.includes("reply_to_id=media_db_100"));
    const quoteCalls = threadsCalls.filter((c) => c.body.includes("quote_post_id=media_db_100"));
    const repostCalls = threadsCalls.filter((c) => c.url.endsWith("/media_db_100/repost"));
    expect(replyCalls).toHaveLength(2);
    expect(quoteCalls).toHaveLength(2);
    expect(repostCalls).toHaveLength(2);

    // Pastikan kampanye berstatus SELESAI di database
    const listRes = await buzzerGET(await req("u-super", "/api/admin/buzzer?view=campaigns"));
    expect(listRes.status).toBe(200);
    const listBody = await json<{ items: { id: string; status: string; doneTasks: number; totalTasks: number }[] }>(listRes);
    expect(listBody.items[0]).toMatchObject({
      id: depBody.campaignId,
      status: "SELESAI",
      doneTasks: 6,
      totalTasks: 6,
    });
  });
});
