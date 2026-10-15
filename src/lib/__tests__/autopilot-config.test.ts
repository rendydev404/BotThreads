import { afterEach, describe, expect, it } from "vitest";
import { maxPostsForGap, parseSettingsPatch } from "../autopilot-config";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { DEFAULT_BRAND, applyBrand } from "../brand";
import { CRON_HEADER, cronSecretConfigured, isCronAuthorized } from "../cron-auth";
import {
  appOrigin,
  authorizeUrl,
  decodeOauthCookie,
  encodeOauthCookie,
  newOauthState,
  stateMatches,
  usernameFromEmail,
} from "../google-oauth";
import { hashToken, isToken, newToken, passwordError } from "../team-service";

describe("pengaturan autopilot", () => {
  const parse = (patch: unknown) => parseSettingsPatch(patch, DEFAULT_SETTINGS);

  it("field yang tidak dikirim tidak berubah", () => {
    const r = parse({ mode: "OTOMATIS" });
    expect(r).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, mode: "OTOMATIS" } });
  });

  it("minimal 1 dan maksimal 6 posting per hari; jeda minimal 120 menit", () => {
    expect(parse({ postsPerDay: 0 })).toMatchObject({ ok: false });
    expect(parse({ postsPerDay: 1 })).toMatchObject({ ok: true });
    expect(parse({ postsPerDay: 7 })).toMatchObject({ ok: false });
    expect(parse({ postsPerDay: 3.5 })).toMatchObject({ ok: false });
    expect(parse({ minGapMinutes: 60 })).toMatchObject({ ok: false });
    expect(parse({ postsPerDay: 6, minGapMinutes: 120 })).toMatchObject({ ok: true });
  });

  it("jumlah posting harus muat di jendela tayang dengan jeda yang dipilih", () => {
    expect(maxPostsForGap(150)).toBe(7);
    expect(maxPostsForGap(240)).toBe(5);
    expect(parse({ postsPerDay: 6, minGapMinutes: 240 })).toEqual({ ok: false, error: "Dengan jeda 240 menit, paling banyak 5 posting per hari." });
  });

  it("jam tetap: jumlah posting mengikuti jumlah jam, jarak divalidasi", () => {
    const r = parse({ slotStrategy: "JAM_TETAP", fixedHours: [20, 7, 12, 16] });
    expect(r).toMatchObject({ ok: true, value: { postsPerDay: 4, fixedHours: [7, 12, 16, 20] } });
    expect(parse({ slotStrategy: "JAM_TETAP", fixedHours: [7, 8, 20] })).toMatchObject({ ok: false });
    expect(parse({ slotStrategy: "JAM_TETAP", fixedHours: [7, 12] })).toMatchObject({ ok: false });
    expect(parse({ slotStrategy: "JAM_TETAP", fixedHours: [7, 12, 25] })).toMatchObject({ ok: false });
  });

  it("tema dirapikan, pilar divalidasi, nilai asing ditolak", () => {
    expect(parse({ brief: "  akun   santai soal makan  " })).toMatchObject({ ok: true, value: { brief: "akun santai soal makan" } });
    expect(parse({ brief: "" })).toMatchObject({ ok: true, value: { brief: null } });
    expect(parse({ brief: "x".repeat(601) })).toMatchObject({ ok: false });
    expect(parse({ pillars: [{ key: "Edukasi", bobot: 60 }, { key: "Cerita", bobot: 40 }] })).toMatchObject({ ok: true });
    expect(parse({ pillars: [{ key: "Edukasi", bobot: 60 }, { key: "edukasi", bobot: 40 }] })).toMatchObject({ ok: false });
    expect(parse({ pillars: [{ key: "E", bobot: 60 }] })).toMatchObject({ ok: false });
    expect(parse({ pillars: [{ key: "Edukasi", bobot: 0 }] })).toMatchObject({ ok: false });
    expect(parse({ mode: "GILA" })).toMatchObject({ ok: false });
    expect(parse({ voiceStyle: "formal" })).toMatchObject({ ok: false });
    expect(parse({ voiceStyle: "gue_lo" })).toMatchObject({ ok: true });
    expect(parse({ activeDays: [] })).toMatchObject({ ok: false });
    expect(parse({ exploreRate: 0.5 })).toMatchObject({ ok: false });
    expect(parse({ promoRatio: 0.31 })).toMatchObject({ ok: false });
    expect(parse(null)).toMatchObject({ ok: false });
  });
});

describe("rahasia penjadwal", () => {
  const SECRET = "rahasia-cron-yang-panjangnya-lebih-dari-32-karakter";
  afterEach(() => {
    delete process.env.AUTOPILOT_CRON_SECRET;
  });
  const req = (value?: string) => ({ headers: new Headers(value ? { [CRON_HEADER]: value } : {}) });

  it("tanpa rahasia terpasang (atau terlalu pendek) semua permintaan ditolak", () => {
    expect(cronSecretConfigured()).toBe(false);
    expect(isCronAuthorized(req(SECRET))).toBe(false);
    process.env.AUTOPILOT_CRON_SECRET = "pendek";
    expect(cronSecretConfigured()).toBe(false);
    expect(isCronAuthorized(req("pendek"))).toBe(false);
  });

  it("hanya rahasia yang persis sama yang diterima", () => {
    process.env.AUTOPILOT_CRON_SECRET = SECRET;
    expect(isCronAuthorized(req(SECRET))).toBe(true);
    expect(isCronAuthorized(req(`${SECRET}x`))).toBe(false);
    expect(isCronAuthorized(req(SECRET.slice(0, -1)))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });
});

describe("brand di prompt", () => {
  const prompt = "asisten untuk jaringan Suka Shawarma (kuliner shawarma). Bantu akun Suka Shawarma.";
  it("brand bawaan tidak mengubah teks", () => {
    expect(applyBrand(prompt, DEFAULT_BRAND)).toBe(prompt);
  });
  it("brand workspace menggantikan nama dan deskripsi, kurung sudut dibuang", () => {
    expect(applyBrand(prompt, { nama: "Kopi <b>Senja</b>", deskripsi: "kedai kopi" })).toBe(
      "asisten untuk jaringan Kopi b Senja /b (kedai kopi). Bantu akun Kopi b Senja /b."
    );
    expect(applyBrand(prompt, { nama: "Kopi Senja", deskripsi: "" })).toBe("asisten untuk jaringan Kopi Senja. Bantu akun Kopi Senja.");
  });
});

describe("pembantu masuk dengan Google", () => {
  afterEach(() => {
    delete process.env.APP_URL;
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it("state tersimpan utuh di cookie dan dibandingkan persis", () => {
    const s = newOauthState("/jadwal", null);
    expect(decodeOauthCookie(encodeOauthCookie(s))).toEqual(s);
    expect(decodeOauthCookie("bukan-base64-json")).toBeNull();
    expect(decodeOauthCookie(undefined)).toBeNull();
    expect(stateMatches(s.state, s.state)).toBe(true);
    expect(stateMatches(s.state, `${s.state}x`)).toBe(false);
    expect(stateMatches(s.state, null)).toBe(false);
    expect(newOauthState("/", null).state).not.toBe(s.state);
  });

  it("alamat kembali memakai APP_URL, atau header proxy bila tidak diatur", () => {
    const req = { headers: new Headers({ "x-forwarded-host": "wargi.contoh.id", "x-forwarded-proto": "https" }), nextUrl: { origin: "http://0.0.0.0:3000" } };
    expect(appOrigin(req)).toBe("https://wargi.contoh.id");
    process.env.APP_URL = "https://dash.contoh.id/";
    expect(appOrigin(req)).toBe("https://dash.contoh.id");
    process.env.GOOGLE_CLIENT_ID = "klien-uji";
    const url = new URL(authorizeUrl(appOrigin(req), newOauthState("/", null)));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://dash.contoh.id/api/auth/google/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("client_id")).toBe("klien-uji");
  });

  it("username dari email selalu memenuhi pola username", () => {
    expect(usernameFromEmail("Budi.Santoso+kerja@contoh.id")).toBe("budi.santosokerja");
    expect(usernameFromEmail("a@contoh.id")).toBe("usera");
    expect(usernameFromEmail("_.x@contoh.id", "-ab12")).toBe("userx-ab12");
  });
});

describe("token tautan dan aturan password", () => {
  it("token acak 256-bit; yang disimpan hanya hash-nya", () => {
    const a = newToken();
    const b = newToken();
    expect(a.token).not.toBe(b.token);
    expect(isToken(a.token)).toBe(true);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
    expect(isToken("pendek")).toBe(false);
    expect(isToken(`${a.token}/../x`)).toBe(false);
  });
  it("password minimal 10 karakter", () => {
    expect(passwordError("123456789")).toMatch(/minimal 10/);
    expect(passwordError("1234567890")).toBeNull();
    expect(passwordError(12345678901)).toBe("Password tidak valid.");
    expect(passwordError("x".repeat(201))).toMatch(/maksimal/);
  });
});
