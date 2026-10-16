/**
 * Uji race condition: kunci per kunci (keyed-lock), percobaan login serentak, IP klien yang tidak bisa
 * dipalsukan, dan kuota posting saat dua permintaan ke akun yang sama datang bersamaan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  rpc: vi.fn(),
  tenantIdOf: async (w: string | null) => w,
}));

import { rpc } from "@/lib/supabase";
import { heldKeys, withKeys } from "../keyed-lock";
import { clearFailures, lockedSeconds, recordFailure } from "../rate-limit";
import { clientIp } from "../session-cookie";
import { createPosts } from "../threads-publish";
import { throttle } from "../throttle";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("withKeys", () => {
  it("kunci sama berjalan berurutan, kunci berbeda paralel", async () => {
    const log: string[] = [];
    const job = (key: string, name: string) =>
      withKeys([key], async () => {
        log.push(`${name}:mulai`);
        await tick();
        log.push(`${name}:selesai`);
      });
    await Promise.all([job("a", "1"), job("a", "2"), job("b", "3")]);
    // 1 dan 2 tidak tumpang tindih; 3 (kunci lain) mulai sebelum 1 selesai.
    expect(log.indexOf("2:mulai")).toBeGreaterThan(log.indexOf("1:selesai"));
    expect(log.indexOf("3:mulai")).toBeLessThan(log.indexOf("1:selesai"));
    expect(heldKeys()).toBe(0);
  });

  it("galat melepas kunci dan kunci banyak tidak saling mengunci", async () => {
    await expect(withKeys(["x"], async () => Promise.reject(new Error("gagal")))).rejects.toThrow("gagal");
    // Urutan kunci terbalik di dua pemanggil: tanpa pengurutan, ini bisa deadlock.
    const r = await Promise.all([withKeys(["p", "q"], async () => (await tick(), 1)), withKeys(["q", "p"], async () => (await tick(), 2))]);
    expect(r).toEqual([1, 2]);
    expect(heldKeys()).toBe(0);
  });
});

describe("pembatas login", () => {
  it("percobaan dicatat sebelum verifikasi: burst serentak tidak melewati batas", async () => {
    const key = "id:burst-uji";
    clearFailures(key);
    let lolos = 0;
    // Meniru urutan di route login: cek kunci, catat (sinkron), lalu verifikasi yang lambat.
    await Promise.all(
      Array.from({ length: 50 }, async () => {
        if (lockedSeconds(key) > 0) return;
        recordFailure(key, 10);
        lolos += 1;
        await tick();
      })
    );
    expect(lolos).toBe(10);
    clearFailures(key);
  });

  it("throttle penuh hanya membuang kunci tertua, batas pengguna lain tetap berlaku", () => {
    for (let i = 0; i < 3; i++) throttle("korban", 3, 60_000, 1000);
    expect(throttle("korban", 3, 60_000, 1000).ok).toBe(false);
    // Banjir kunci baru (mis. penyerang) tidak boleh mereset batas "korban" sekaligus.
    for (let i = 0; i < 2500; i++) throttle(`banjir-${i}`, 3, 60_000, 1000);
    expect(throttle("korban", 3, 60_000, 1000).ok).toBe(false);
  });
});

describe("clientIp", () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
  afterEach(() => delete process.env.TRUST_CLOUDFLARE_IP);

  it("mengabaikan cf-connecting-ip/x-real-ip yang dikirim klien", () => {
    expect(clientIp(req({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(req({ "x-real-ip": "2.2.2.2" }))).toBe("unknown");
  });

  it("cf-connecting-ip dipakai hanya bila situs memang di belakang Cloudflare", () => {
    process.env.TRUST_CLOUDFLARE_IP = "true";
    expect(clientIp(req({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" }))).toBe("1.1.1.1");
  });
});

describe("createPosts serentak ke akun yang sama", () => {
  const NOW = new Date("2026-10-12T03:00:00Z");
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
  const rows: { aid: string; postId: string; at: string; source: string; caption: string }[] = [];

  beforeEach(() => {
    process.env.CONTENT_MIN_GAP_MINUTES = "60";
    rows.length = 0;
    vi.mocked(rpc).mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      switch (fn) {
        case "dash_publish_accounts":
          return [
            {
              id: "a", username: "a", displayName: "a", avatarUrl: null, needsReconnect: false, accessExpiresAt: "2099-01-01T00:00:00",
              scopes: ["threads_content_publish"], socialAccountId: "sa-a", outletId: "o-a", outletNama: "Cabang a", outletActive: true, workspaceId: "w1",
            },
          ] as never;
        case "dash_schedule":
          // Jadwal dibaca dari "database" saat ini; jeda meniru latensi jaringan.
          await tick();
          return rows.map((r) => ({ ...r })) as never;
        case "dash_create_posts":
          await tick();
          for (const it of args!.p_items as { postId: string; tayangPada: string; caption: string }[]) {
            rows.push({ aid: "a", postId: it.postId, at: it.tayangPada.replace("Z", ""), source: "DASHBOARD_AI", caption: it.caption });
          }
          return (args!.p_items as unknown[]).length as never;
        default:
          return [] as never;
      }
    });
  });

  it("dua permintaan berjarak 10 menit: hanya satu yang masuk (jarak minimal 60 menit dijaga)", async () => {
    const send = (key: string, minutes: number, text: string) =>
      createPosts({ userId: "u", idempotencyKey: key, items: [{ threadsAccountId: "a", text, topicTag: null, publishAt: at(minutes), aiModel: "uji", aiEdited: false }] }, NOW);
    const [r1, r2] = await Promise.all([send("k1", 120, "Draf pertama yang cukup panjang"), send("k2", 130, "Draf kedua yang juga cukup panjang")]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });
});
