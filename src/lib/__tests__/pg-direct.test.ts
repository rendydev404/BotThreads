import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient, listLocalTmpOrphans, type SqlExecutor } from "../pg-direct";

const REPO = path.resolve(__dirname, "../../..");

describe("pg-direct + sql/000_base_schema.sql", () => {
  let pglite: PGlite;
  let client: ReturnType<typeof createPgClient>;
  let tmpMediaDir: string;

  beforeAll(async () => {
    tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-media-test-"));
    process.env.MEDIA_STORAGE_DIR = tmpMediaDir;
    process.env.APP_URL = "https://bottrit.com";

    pglite = new PGlite({ extensions: { pg_trgm } });
    await pglite.exec(fs.readFileSync(path.join(REPO, "sql/000_base_schema.sql"), "utf8"));

    const exec: SqlExecutor = {
      query: async (text, values) => {
        const res = await pglite.query(text, values);
        return { rows: res.rows as never[], rowCount: res.affectedRows ?? res.rows.length };
      },
    };
    client = createPgClient(exec);
  });

  afterAll(async () => {
    await pglite.close();
    fs.rmSync(tmpMediaDir, { recursive: true, force: true });
    delete process.env.MEDIA_STORAGE_DIR;
  });

  it("insert, select relasi many-to-one, filter .or(), .not(in), count exact, dan delete", async () => {
    const wsIns = await client
      .from("Workspace")
      .insert({ id: "ws_1", nama: "Brand Mandiri", slug: "brand-mandiri" })
      .select("id, nama, slug")
      .single();
    expect(wsIns.error).toBeNull();
    expect(wsIns.data).toEqual({ id: "ws_1", nama: "Brand Mandiri", slug: "brand-mandiri" });

    await client.from("ThreadsAccount").insert([
      {
        id: "acc_1",
        workspaceId: "ws_1",
        threadsUserId: "tu_1",
        username: "akun_satu",
        displayName: "Akun Satu",
        accessToken: "tok_1",
      },
      {
        id: "acc_2",
        workspaceId: "ws_1",
        threadsUserId: "tu_2",
        username: "akun_dua",
        displayName: "Akun Dua",
        accessToken: "tok_2",
      },
    ]);

    // Relasi ThreadsAccount -> Workspace(slug, nama)
    const accWithWs = await client
      .from("ThreadsAccount")
      .select("id, username, displayName, Workspace(slug, nama)")
      .eq("id", "acc_1")
      .maybeSingle();
    expect(accWithWs.error).toBeNull();
    expect(accWithWs.data).toEqual({
      id: "acc_1",
      username: "akun_satu",
      displayName: "Akun Satu",
      Workspace: { slug: "brand-mandiri", nama: "Brand Mandiri" },
    });

    // Upsert ThreadsPostStat & relasi ThreadsPostStat -> ThreadsAccount
    const upStat = await client.from("ThreadsPostStat").upsert(
      [
        {
          threadsAccountId: "acc_1",
          mediaId: "m_100",
          mediaType: "TEXT_POST",
          text: "Halo dunia mandiri",
          postedAt: "2026-10-15T10:00:00",
          views: 250,
          likes: 20,
          replies: 5,
        },
        {
          threadsAccountId: "acc_2",
          mediaId: "m_101",
          mediaType: "IMAGE",
          text: "Postingan kedua",
          postedAt: "2026-10-16T10:00:00",
          views: 500,
          likes: 45,
          replies: 10,
        },
      ],
      { onConflict: "mediaId" }
    );
    expect(upStat.error).toBeNull();

    // Select dengan count exact + not in + order + range + relasi
    const statList = await client
      .from("ThreadsPostStat")
      .select("mediaId, views, ThreadsAccount(username, displayName)", { count: "exact" })
      .not("threadsAccountId", "in", "(acc_2)")
      .order("views", { ascending: false })
      .range(0, 9);
    expect(statList.error).toBeNull();
    expect(statList.count).toBe(1);
    expect(statList.data).toEqual([
      {
        mediaId: "m_100",
        views: 250,
        ThreadsAccount: { username: "akun_satu", displayName: "Akun Satu" },
      },
    ]);

    // Head count
    const headCount = await client
      .from("ThreadsPostStat")
      .select("id", { count: "exact", head: true })
      .eq("threadsAccountId", "acc_1");
    expect(headCount.count).toBe(1);
    expect(headCount.data).toBeNull();

    // Filter .or() pada DashboardUser
    await client.from("DashboardUser").insert({
      id: "u_1",
      username: "rendy",
      email: "rendy@bottrit.com",
      name: "Rendy",
      passwordHash: "hash123",
    });
    const byEmail = await client
      .from("DashboardUser")
      .select("id, username, email")
      .or('username.eq."rendy@bottrit.com",email.eq."rendy@bottrit.com"')
      .maybeSingle();
    expect(byEmail.data).toEqual({ id: "u_1", username: "rendy", email: "rendy@bottrit.com" });
  });

  it("menjalankan fungsi agregasi RPC RETURNS TABLE dan skalar di sql/000_base_schema.sql", async () => {
    await client.from("ThreadsAccountDaily").upsert(
      [
        {
          threadsAccountId: "acc_1",
          date: "2026-10-15",
          followers: 120,
          views: 1000,
          likes: 50,
          replies: 10,
          reposts: 2,
          quotes: 1,
        },
        {
          threadsAccountId: "acc_1",
          date: "2026-10-16",
          followers: 135,
          views: 1500,
          likes: 80,
          replies: 15,
          reposts: 4,
          quotes: 2,
        },
      ],
      { onConflict: "threadsAccountId,date" }
    );

    const byDate = await client.rpc("dash_daily_by_date", {
      p_from: "2026-10-15",
      p_to: "2026-10-16",
      p_ids: ["acc_1"],
    });
    expect(byDate.error).toBeNull();
    expect(byDate.data).toEqual([
      {
        date: "2026-10-15",
        views: 1000,
        likes: 50,
        replies: 10,
        reposts: 2,
        quotes: 1,
        followers: 120,
        followers_count: 1,
      },
      {
        date: "2026-10-16",
        views: 1500,
        likes: 80,
        replies: 15,
        reposts: 4,
        quotes: 2,
        followers: 135,
        followers_count: 1,
      },
    ]);

    const maxDate = await client.rpc("dash_daily_max_date", { p_ids: ["acc_1"] });
    expect(maxDate.data).toBe("2026-10-16");

    const latestFollowers = await client.rpc("dash_latest_followers", { p_ids: ["acc_1"] });
    expect(latestFollowers.data).toEqual([
      { threadsAccountId: "acc_1", followers: 135, date: "2026-10-16" },
    ]);

    const postsByAcc = await client.rpc("dash_posts_by_account", { p_ids: ["acc_1", "acc_2"] });
    expect(postsByAcc.data).toEqual(
      expect.arrayContaining([
        { threadsAccountId: "acc_1", posts: 1 },
        { threadsAccountId: "acc_2", posts: 1 },
      ])
    );
  });

  it("menyimpan, menyajikan URL publik, menyapu yatim, dan menghapus berkas media lokal", async () => {
    const store = client.storage.from("threads-media");
    const up = await store.upload("tmp/post_123/0.jpg", Buffer.from([0xff, 0xd8, 0xff]));
    expect(up.error).toBeNull();

    const pub = store.getPublicUrl("tmp/post_123/0.jpg");
    expect(pub.data.publicUrl).toBe("https://bottrit.com/api/media/threads-media/tmp/post_123/0.jpg");

    // Berkas baru tidak dianggap yatim untuk batas waktu masa lalu, tapi terdeteksi bila batas waktu di masa depan
    expect(await listLocalTmpOrphans("threads-media", Date.now() - 60_000)).toEqual([]);
    expect(await listLocalTmpOrphans("threads-media", Date.now() + 60_000)).toEqual(["tmp/post_123/0.jpg"]);

    const rem = await store.remove(["tmp/post_123/0.jpg"]);
    expect(rem.error).toBeNull();
    expect(await listLocalTmpOrphans("threads-media", Date.now() + 60_000)).toEqual([]);
  });
});
