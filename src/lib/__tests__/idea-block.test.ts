import { afterEach, describe, expect, it } from "vitest";
import {
  hasPlaceholder,
  ideaPlainText,
  ideaPostText,
  ideaSegments,
  nextWibSlot,
  parseIdea,
  stripPlaceholders,
} from "../idea-block";
import { factSentences } from "../account-facts";
import { isExcludedUsername, withoutExcluded } from "../account-visibility";
import { PLACEHOLDER } from "../content-ai";

const BLOCK = `akun: @akbaralatas
sudut: Prompt praktis
jam: 18.00
alasan: Tiru post ranking 1 (13.437 views).
---
Prompt ini motong riset konten dari 2 jam jadi 10 menit.

[PROMPT]
Kamu analis tren Threads. Beri 5 ide "hook" untuk niche {niche}, format: tabel.
[/PROMPT]

AI tools apa yang paling sering lu pake?`;

describe("parseIdea", () => {
  it("membaca kepala blok dan isi", () => {
    const idea = parseIdea(BLOCK)!;
    expect(idea.account).toBe("akbaralatas");
    expect(idea.angle).toBe("Prompt praktis");
    expect(idea.time).toEqual({ h: 18, m: 0 });
    expect(idea.reason).toContain("13.437");
    expect(idea.body.startsWith("Prompt ini")).toBe(true);
  });

  it("tanpa pemisah, seluruh blok dianggap isi", () => {
    expect(parseIdea("Cuma teks")?.body).toBe("Cuma teks");
    expect(parseIdea("akun: @x\n---\n   ")).toBeNull();
  });

  it("label petunjuk format yang ikut tersalin dibuang", () => {
    expect(parseIdea("akun: <@foo>\n---\nteks postingan lengkap siap posting: WOI ini dia")).toMatchObject({
      account: "foo",
      body: "WOI ini dia",
    });
  });

  it("jam tidak valid diabaikan", () => {
    expect(parseIdea("jam: 27:00\n---\nisi")?.time).toBeNull();
  });
});

describe("segmen prompt", () => {
  it("memisahkan prompt dan membuang penanda di teks posting", () => {
    const body = parseIdea(BLOCK)!.body;
    const segs = ideaSegments(body);
    expect(segs.map((s) => s.kind)).toEqual(["text", "prompt", "text"]);
    expect(segs[1].text).toContain('"hook"');
    const post = ideaPostText(body);
    expect(post).not.toMatch(/\[\/?PROMPT\]/);
    expect(post).toContain("Kamu analis tren Threads.");
  });

  it("penanda penutup hilang tetap terbaca", () => {
    expect(ideaSegments("Hook\n[PROMPT]\nisi prompt").map((s) => s.kind)).toEqual(["text", "prompt"]);
  });

  it("teks salin mengganti blok ide jadi teks biasa", () => {
    const plain = ideaPlainText("Pengantar\n\n```ide\n" + BLOCK + "\n```\nPenutup");
    expect(plain).toContain("@akbaralatas · Prompt praktis · 18:00 WIB");
    expect(plain).not.toContain("```");
    expect(plain).not.toContain("[PROMPT]");
  });
});

describe("nextWibSlot", () => {
  const now = new Date("2026-10-12T08:00:00Z"); // 15.00 WIB
  it("hari ini bila jamnya belum lewat", () => {
    expect(nextWibSlot({ h: 18, m: 0 }, now).toISOString()).toBe("2026-10-12T11:00:00.000Z");
  });
  it("besok bila jamnya sudah lewat", () => {
    expect(nextWibSlot({ h: 9, m: 30 }, now).toISOString()).toBe("2026-10-13T02:30:00.000Z");
  });
});

describe("akun dikecualikan", () => {
  afterEach(() => {
    delete process.env.EXCLUDED_THREADS_ACCOUNTS;
  });

  it("maulanayusuf7923 selalu dikecualikan, tanpa peduli huruf besar atau @", () => {
    expect(isExcludedUsername("@MaulanaYusuf7923")).toBe(true);
    expect(isExcludedUsername("akbaralatas")).toBe(false);
    expect(isExcludedUsername(null)).toBe(false);
  });

  it("env menambah daftar", () => {
    process.env.EXCLUDED_THREADS_ACCOUNTS = "@foo, bar";
    const rows = [{ username: "foo" }, { username: "bar" }, { username: "maulanayusuf7923" }, { username: "ok" }, { username: null }];
    expect(withoutExcluded(rows).map((r) => r.username)).toEqual(["ok", null]);
  });
});

describe("PLACEHOLDER", () => {
  it("menangkap isi yang dijanjikan tapi tidak ditulis", () => {
    expect(PLACEHOLDER.test("Format: [isi detail prompt]. Sikat langsung.")).toBe(true);
    expect(PLACEHOLDER.test("Tim [pedas] atau [manis]?")).toBe(false);
  });
});

describe("placeholder di jawaban chat", () => {
  const answer = [
    "Ide untuk cabang.",
    "",
    "```ide",
    "akun: @sukashawarmapamulang",
    "sudut: Sapaan lokal",
    "---",
    "Warga Pamulang, jangan lupa mampir [isi detail lokasi].",
    "",
    "Bisa dine-in, tim pedas atau tim original?",
    "```",
    "",
    "```ide",
    "akun: @akbaralatas",
    "---",
    "Prompt foto produk biar kayak iklan.",
    "[PROMPT]",
    "Ubah foto [nama produk] jadi foto iklan profesional, cahaya samping, latar kayu.",
    "[/PROMPT]",
    "Udah coba?",
    "```",
  ].join("\n");

  it("terdeteksi di luar bagian prompt saja", () => {
    expect(hasPlaceholder(answer)).toBe(true);
    expect(hasPlaceholder(answer.replace(" [isi detail lokasi]", ""))).toBe(false);
  });

  it("kalimat berplaceholder dibuang, prompt tidak disentuh", () => {
    const out = stripPlaceholders(answer);
    expect(hasPlaceholder(out)).toBe(false);
    expect(out).not.toContain("jangan lupa mampir");
    expect(out).toContain("Bisa dine-in, tim pedas atau tim original?");
    expect(out).toContain("[nama produk]");
    expect(parseIdea(out.split("```ide\n")[1].split("```")[0])?.account).toBe("sukashawarmapamulang");
  });

  it("blok yang isinya habis dibuang utuh", () => {
    const out = stripPlaceholders("```ide\nakun: @x\n---\nMampir ke [alamat outlet].\n```");
    expect(out).not.toContain("```ide");
  });
});

describe("factSentences", () => {
  it("mengambil kalimat lokasi/harga/menu saja", () => {
    expect(
      factSentences("Laper malem gini enaknya apa ya. Kami di Jl. Siliwangi No. 12, depan Pamulang Square! Shawarma beef cuma Rp25 ribu.")
    ).toEqual(["Kami di Jl. Siliwangi No. 12, depan Pamulang Square!", "Shawarma beef cuma Rp25 ribu."]);
    expect(factSentences("Siapa yang suka pedas?")).toEqual([]);
  });
});
