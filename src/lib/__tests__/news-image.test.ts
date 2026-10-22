import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateOptions } from "../gemini";

const mocks = vi.hoisted(() => ({
  hermes: vi.fn(),
  upload: vi.fn(),
  used: vi.fn(),
  remember: vi.fn(),
  config: { brief: "Kuliner nusantara dan jajanan kaki lima", pillars: [{ key: "Resep", bobot: 50 }] } as unknown,
}));

vi.mock("../gemini", async (orig) => ({
  ...(await orig<typeof import("../gemini")>()),
  generateWithFailover: (o: GenerateOptions) => mocks.hermes(o),
}));
vi.mock("../media-store", async (orig) => ({
  ...(await orig<typeof import("../media-store")>()),
  uploadMediaImage: (path: string, jpeg: Buffer) => mocks.upload(path, jpeg),
  mediaUsedKeys: (a: string, k: string[], s: Date) => mocks.used(a, k, s),
  rememberMediaUse: (a: string, k: string[], n?: Date) => mocks.remember(a, k, n),
  deleteMediaFiles: vi.fn(),
}));
vi.mock("../supabase", async (orig) => ({
  ...(await orig<typeof import("../supabase")>()),
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.config, error: null }) }) }),
    }),
  }),
}));

import {
  MIN_SCORE,
  articleImages,
  choosePhotos,
  decodeBingLink,
  extractOgImage,
  forgetNewsImageCache,
  imageKeyOf,
  isSafeTitle,
  mergeArticles,
  parseBingRss,
  parseJudgement,
  parseWikimedia,
  pickIdeaMedia,
  wikimediaLicenseOk,
  type JudgeableCandidate,
  type NewsArticle,
  type PickMediaInput,
} from "../news-image";
import { downloadSourceImage, probeImage, toJpeg, wikiUa } from "../media-store";

const HOUR = 3_600_000;

const bingItem = (title: string, url: string, agoHours = 5, source = "Media") =>
  `<item><title>${title}</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=ab12&amp;url=${encodeURIComponent(
    url
  ).toLowerCase()}&amp;c=123&amp;mkt=en-id</link><description>ringkasan</description><pubDate>${new Date(
    Date.now() - agoHours * HOUR
  ).toUTCString()}</pubDate><News:Source>${source}</News:Source><News:Image>http://www.bing.com/th?id=ONUT.x&amp;pid=News</News:Image></item>`;

const rss = (...items: string[]) => `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>x</title>${items.join("")}</channel></rss>`;

const head = (meta: string, body = "") =>
  `<!doctype html><html><head><title>Artikel</title>${meta}</head><body>${body}<meta property="og:image" content="https://cdn.example/body.jpg"></body></html>`;

let bigJpeg: Buffer;
let smallJpeg: Buffer;

beforeAll(async () => {
  bigJpeg = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "Fotografer" } } })
    .toBuffer();
  smallJpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
});

describe("Bing News RSS", () => {
  it("mengurai tautan klik Bing menjadi URL artikel asli", () => {
    expect(
      decodeBingLink(
        "http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=6ad&amp;url=https%3a%2f%2fwww.liputan6.com%2fhot%2fread%2f5856052%2fkuliner&amp;c=1&amp;mkt=en-id"
      )
    ).toBe("https://www.liputan6.com/hot/read/5856052/kuliner");
    expect(decodeBingLink("http://www.bing.com/news/apiclick.aspx?ref=FexRss")).toBeNull();
    expect(decodeBingLink("http://www.bing.com/news/apiclick.aspx?url=javascript%3aalert(1)")).toBeNull();
    expect(decodeBingLink("https://detik.com/a#x")).toBe("https://detik.com/a");
  });

  it("parse butir, buang yang lebih tua dari 7 hari atau rusak", () => {
    const now = new Date();
    const items = parseBingRss(
      rss(
        bingItem("Martabak manis legendaris di Bandung ramai antrean", "https://www.kompas.com/food/read/1", 3, "Kompas"),
        bingItem("Berita lama sekali tentang kuliner Jakarta", "https://detik.com/food/2", 24 * 9),
        bingItem("Artikel agregator yang dirender JavaScript", "https://www.msn.com/id-id/berita/x", 2),
        "<item><title>tanpa tanggal yang cukup panjang</title><link>https://a.example/x</link></item>"
      ),
      now
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Martabak manis legendaris di Bandung ramai antrean",
      url: "https://www.kompas.com/food/read/1",
      source: "Kompas",
      host: "kompas.com",
    });
  });
});

describe("saringan berita keras", () => {
  const art = (title: string, url: string, host = new URL(url).hostname): NewsArticle => ({ title, url, source: null, host, publishedAt: 0 });

  it("judul berita keras dan topik sensitif dibuang", () => {
    expect(isSafeTitle("Polisi tangkap pengedar narkoba di Medan")).toBe(false);
    expect(isSafeTitle("Kecelakaan maut di tol Cipali")).toBe(false);
    expect(isSafeTitle("5 resep sambal matah yang segar untuk akhir pekan")).toBe(true);
  });

  it("gabung bergiliran, buang kembar dan batasi per domain", () => {
    const a = [
      art("Resep rendang daging empuk ala Padang", "https://a.id/1"),
      art("Menteri resmikan pasar kuliner baru", "https://a.id/2"),
      art("Resep rendang daging empuk ala Padang!", "https://a.id/3"),
    ];
    const b = [art("Soto Betawi jadi favorit sarapan", "https://b.id/1"), art("Ragam sate nusantara yang wajib dicoba", "https://b.id/2")];
    const out = mergeArticles([a, b], ["menteri"]);
    expect(out.map((x) => x.url)).toEqual(["https://a.id/1", "https://b.id/1", "https://b.id/2"]);
  });
});

describe("og:image", () => {
  it("hanya dari <head>; relatif menjadi absolut", () => {
    expect(extractOgImage(head('<meta property="og:image" content="/img/2026/foto.jpg?w=1200&amp;h=630">'), "https://www.kompas.com/food/1")).toBe(
      "https://www.kompas.com/img/2026/foto.jpg?w=1200&h=630"
    );
    // og:image hanya ada di <body>: diabaikan.
    expect(extractOgImage(head(""), "https://a.id/1")).toBeNull();
  });

  it("cadangan twitter:image; http, logo, dan og:image sempit ditolak", () => {
    expect(extractOgImage(head(`<meta name='twitter:image' content='https://cdn.a.id/x.jpg'>`), "https://a.id/1")).toBe("https://cdn.a.id/x.jpg");
    expect(extractOgImage(head('<meta property="og:image" content="http://cdn.a.id/x.jpg">'), "https://a.id/1")).toBeNull();
    expect(extractOgImage(head('<meta property="og:image" content="https://a.id/assets/logo-share.png">'), "https://a.id/1")).toBeNull();
    expect(
      extractOgImage(
        head('<meta property="og:image" content="https://a.id/thumb.jpg"><meta property="og:image:width" content="300">'),
        "https://a.id/1"
      )
    ).toBeNull();
  });

  it("membaca kepala halaman saja lalu berhenti; gambar sama di dua artikel dianggap bawaan situs", async () => {
    let pulls = 0;
    const endless = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(head('<meta property="og:image" content="https://cdn.a.id/default-share.jpg?v=2">')));
        },
        pull(c) {
          pulls++;
          c.enqueue(new TextEncoder().encode("<p>isi panjang</p>".repeat(1000)));
        },
      });
    const pages: Record<string, () => Response> = {
      "https://a.id/1": () => new Response(endless(), { headers: { "content-type": "text/html" } }),
      "https://b.id/1": () => new Response(head('<meta property="og:image" content="https://cdn.b.id/sama.jpg">'), { headers: { "content-type": "text/html" } }),
      "https://b.id/2": () => new Response(head('<meta property="og:image" content="https://cdn.b.id/sama.jpg?w=600">'), { headers: { "content-type": "text/html" } }),
      "https://c.id/1": () => new Response(head('<meta property="og:image" content="https://cdn.c.id/unik.jpg">'), { headers: { "content-type": "text/html" } }),
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => pages[url]?.() ?? new Response("x", { status: 404 })));
    const arts = Object.keys(pages).map((url) => ({ title: "Judul artikel kuliner", url, source: null, host: new URL(url).hostname, publishedAt: 0 }));
    const out = await articleImages(arts, new AbortController().signal);
    // a.id: logo/bawaan ("default"); b.id: gambar yang sama untuk dua artikel; c.id: lolos.
    expect(out.map((c) => c.imageUrl)).toEqual(["https://cdn.c.id/unik.jpg"]);
    expect(pulls).toBeLessThanOrEqual(1);
    vi.unstubAllGlobals();
  });

  it("imageKey sama untuk ukuran berbeda dari CDN", () => {
    expect(imageKeyOf("https://www.cdn.id/a.jpg?w=1200&h=600")).toBe(imageKeyOf("https://cdn.id/a.jpg?w=600"));
    expect(imageKeyOf("https://cdn.id/img.php?id=1")).not.toBe(imageKeyOf("https://cdn.id/img.php?id=2"));
  });
});

describe("Wikimedia Commons", () => {
  it("hanya CC-BY, CC-BY-SA, CC0, dan domain publik", () => {
    for (const ok of ["CC BY-SA 4.0", "CC BY 2.0", "CC-BY-SA-3.0", "CC0", "Public domain", "PD-self", "CC BY-SA 3.0 de"]) {
      expect(wikimediaLicenseOk(ok), ok).toBe(true);
    }
    for (const no of ["CC BY-NC-SA 4.0", "CC BY-ND 2.0", "GFDL", "All rights reserved", "", "Fair use"]) {
      expect(wikimediaLicenseOk(no), no).toBe(false);
    }
  });

  it("parse hasil API: lisensi, ukuran, dan urutan peringkat", () => {
    const page = (index: number, title: string, license: string, width = 2000, mime = "image/jpeg") => ({
      title: `File:${title}.jpg`,
      index,
      imageinfo: [
        {
          url: `https://upload.wikimedia.org/${index}.jpg`,
          descriptionurl: `https://commons.wikimedia.org/wiki/File:${index}.jpg`,
          thumburl: `https://upload.wikimedia.org/thumb/${index}.jpg`,
          width,
          height: 1200,
          mime,
          extmetadata: { LicenseShortName: { value: license } },
        },
      ],
    });
    const out = parseWikimedia({
      query: {
        pages: [
          page(3, "Nasi goreng kampung", "CC BY-SA 4.0"),
          page(1, "Nasi goreng NC", "CC BY-NC 2.0"),
          page(2, "Nasi goreng kecil", "CC0", 400),
          page(4, "Nasi goreng svg", "CC0", 2000, "image/svg+xml"),
          page(0, "Nasi goreng pd", "Public domain"),
        ],
      },
    });
    expect(out.map((w) => w.title)).toEqual(["Nasi goreng pd", "Nasi goreng kampung"]);
    expect(out[1]).toMatchObject({ downloadUrl: "https://upload.wikimedia.org/thumb/3.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:3.jpg" });
  });
});

describe("periksa dan olah gambar (media-store)", () => {
  it("toJpeg: perkecil ke 1080, tanpa metadata; yang sempit ditolak", async () => {
    const out = await toJpeg(bigJpeg);
    expect(out).toMatchObject({ width: 1080, height: 675 });
    const meta = await sharp(out!.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(await toJpeg(smallJpeg)).toBeNull();
    expect(await toJpeg(Buffer.from("bukan gambar"))).toBeNull();
  });

  it("probeImage: hanya JPEG/PNG/WebP yang cukup lebar dengan rasio wajar", async () => {
    expect(await probeImage(bigJpeg)).toEqual({ width: 1600, height: 1000 });
    const png = await sharp({ create: { width: 800, height: 800, channels: 4, background: "#fff0" } }).png().toBuffer();
    expect(await probeImage(png)).toEqual({ width: 800, height: 800 });
    const gif = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect(await probeImage(gif)).toBeNull();
    const banner = await sharp({ create: { width: 3000, height: 600, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect(await probeImage(banner)).toBeNull();
    expect(await probeImage(smallJpeg)).toBeNull();
  });

  it("downloadSourceImage: https saja, bukan gambar/terlalu besar ditolak, UA Wikimedia khusus", async () => {
    const seen: { url: string; ua: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url, ua: new Headers(init?.headers).get("user-agent") });
        if (url.includes("html")) return new Response("<html>", { headers: { "content-type": "text/html" } });
        if (url.includes("besar")) return new Response("x", { headers: { "content-type": "image/jpeg", "content-length": String(9 * 1024 * 1024) } });
        return new Response(new Uint8Array(bigJpeg), { headers: { "content-type": "image/jpeg" } });
      })
    );
    expect(await downloadSourceImage("http://a.id/x.jpg")).toBeNull();
    expect(await downloadSourceImage("https://a.id/html")).toBeNull();
    expect(await downloadSourceImage("https://a.id/besar.jpg")).toBeNull();
    expect((await downloadSourceImage("https://a.id/ok.jpg"))?.length).toBe(bigJpeg.length);
    await downloadSourceImage("https://upload.wikimedia.org/a.jpg");
    expect(seen.find((s) => s.url.includes("wikimedia"))?.ua).toBe(wikiUa());
    expect(seen.find((s) => s.url === "https://a.id/ok.jpg")?.ua).toContain("Mozilla/5.0");
    expect(seen.some((s) => s.url.startsWith("http:"))).toBe(false);
    vi.unstubAllGlobals();
  });
});


describe("penilaian visual (murni)", () => {
  const cand = (n: number): JudgeableCandidate => ({
    item: {
      sourceUrl: `https://img.test/${n}.jpg`,
      credit: "media.test",
      sourceKind: "NEWS",
      articleUrl: null,
      articleTitle: null,
      imageKey: `k${n}`,
      width: 1080,
      height: 720,
    },
    thumb: "x",
  });
  const cands = [cand(1), cand(2), cand(3)];

  it("semua foto wajib dinilai; urut skor tertinggi, skor dibatasi 0-10", () => {
    expect(parseJudgement({ foto: [{ no: 1, skor: 9 }] }, cands)).toBeNull();
    expect(parseJudgement({ foto: "x" }, cands)).toBeNull();
    const out = parseJudgement(
      { foto: [{ no: 1, skor: 4, lihat: "logo" }, { no: 2, skor: 12, lihat: "nasi goreng" }, { no: 3, skor: 8 }, { no: 9, skor: 10 }] },
      cands
    );
    expect(out?.map((j) => [j.candidate.item.imageKey, j.score])).toEqual([
      ["k2", 10],
      ["k3", 8],
      ["k1", 4],
    ]);
  });

  it(`hanya skor >= ${MIN_SCORE} dipakai; single satu, carousel maks 4`, () => {
    const judged = parseJudgement({ foto: [{ no: 1, skor: 6 }, { no: 2, skor: 9 }, { no: 3, skor: 7 }] }, cands)!;
    expect(choosePhotos(judged, false).map((i) => i.imageKey)).toEqual(["k2"]);
    expect(choosePhotos(judged, true).map((i) => i.imageKey)).toEqual(["k2", "k3"]);
    expect(choosePhotos(parseJudgement({ foto: cands.map((_, i) => ({ no: i + 1, skor: 5 })) }, cands)!, false)).toEqual([]);
  });
});

describe("pickIdeaMedia", () => {
  const INPUT: PickMediaInput = {
    workspaceId: "ws1",
    accountId: "acc1",
    ideaId: "idea1",
    topik: "Kuliner malam Jakarta",
    sudut: "rekomendasi tempat",
    text: "3 tempat kuliner malam di Jakarta yang wajib kamu coba minggu ini:\n1. Gultik Blok M\n2. Pecel lele Angel\n3. Nasi goreng kambing Kebon Sirih",
  };

  type Plan = { pakaiGambar: boolean; format: "single" | "carousel"; visual?: string; kueri: string[]; wiki?: string };
  let plan: Plan | null;
  /** Skor per foto yang dikirim, urut nomor foto; null = Hermes tidak membalas penilaian. */
  let scores: number[] | null;
  let judgeParts: GenerateOptions["contents"][number]["parts"] = [];
  let fetched: string[] = [];
  let routes: Record<string, () => Response>;

  const html = (img: string) => () => new Response(head(`<meta property="og:image" content="${img}">`), { headers: { "content-type": "text/html" } });
  const jpeg = (buf: () => Buffer) => () => new Response(new Uint8Array(buf()), { headers: { "content-type": "image/jpeg" } });
  const textOf = (p: unknown) => (p as { text?: string }).text ?? "";
  const imagesSent = () => judgeParts.filter((p) => "inlineData" in p).length;
  const wikiRoute = () => {
    routes["https://commons.wikimedia.org/w/api.php"] = () =>
      new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                title: "File:Jakarta street food.jpg",
                index: 1,
                imageinfo: [
                  {
                    url: "https://upload.wikimedia.org/a/street.jpg",
                    descriptionurl: "https://commons.wikimedia.org/wiki/File:Jakarta_street_food.jpg",
                    thumburl: "https://upload.wikimedia.org/thumb/street.jpg",
                    width: 3000,
                    height: 2000,
                    mime: "image/jpeg",
                    extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } },
                  },
                ],
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } }
      );
    routes["https://upload.wikimedia.org/thumb/street.jpg"] = jpeg(() => bigJpeg);
  };

  beforeEach(() => {
    forgetNewsImageCache();
    plan = {
      pakaiGambar: true,
      format: "single",
      visual: "suasana warung kuliner malam di Jakarta",
      kueri: ["kuliner malam jakarta"],
      wiki: "Jakarta street food",
    };
    scores = [9, 8, 8, 8];
    judgeParts = [];
    fetched = [];
    mocks.hermes.mockReset().mockImplementation(async (o: GenerateOptions) => {
      expect(o.providers).toBe("hermes");
      const isJudge = !!o.responseSchema?.properties?.foto;
      let json: unknown;
      if (isJudge) {
        judgeParts = o.contents[0].parts;
        const n = judgeParts.filter((p) => "inlineData" in p).length;
        json = scores ? { foto: scores.slice(0, n).map((skor, i) => ({ no: i + 1, skor, lihat: "foto" })) } : null;
      } else {
        json = plan;
      }
      if (json === null || (o.validate && !o.validate(json))) return null;
      return { text: JSON.stringify(json), model: "hermes-combo", json };
    });
    mocks.upload.mockReset().mockImplementation(async (path: string) => `https://storage.test/threads-media/${path}`);
    mocks.used.mockReset().mockResolvedValue(new Set());
    mocks.remember.mockReset().mockResolvedValue(undefined);
    routes = {
      "https://www.bing.com/news/search": () =>
        new Response(
          rss(
            bingItem("Gultik Blok M tetap jadi primadona kuliner malam", "https://www.kompas.com/food/read/1", 2, "Kompas"),
            bingItem("Polisi bubarkan balap liar di kawasan kuliner malam", "https://www.detik.com/news/2", 2, "detik"),
            bingItem("Pecel lele Angel, warung legendaris yang buka sampai subuh", "https://food.detik.com/3", 4, "detikFood"),
            bingItem("Nasi goreng kambing Kebon Sirih ramai pembeli", "https://www.liputan6.com/lifestyle/4", 6, "Liputan6")
          ),
          { headers: { "content-type": "application/rss+xml" } }
        ),
      "https://www.kompas.com/food/read/1": html("https://asset.kompas.com/gultik.jpg"),
      "https://www.detik.com/news/2": html("https://cdn.detik.net/polisi.jpg"),
      "https://food.detik.com/3": html("https://cdn.detik.net/pecel.jpg"),
      "https://www.liputan6.com/lifestyle/4": html("https://cdn1.liputan6.com/nasgor.jpg"),
      "https://asset.kompas.com/gultik.jpg": jpeg(() => bigJpeg),
      "https://cdn.detik.net/pecel.jpg": jpeg(() => bigJpeg),
      "https://cdn1.liputan6.com/nasgor.jpg": jpeg(() => smallJpeg),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        fetched.push(url);
        const key = Object.keys(routes).find((k) => url === k || url.startsWith(`${k}?`));
        return key ? routes[key]() : new Response("tidak ada", { status: 404 });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Hermes bilang tidak perlu gambar: null tanpa mencari apa pun", async () => {
    plan = { pakaiGambar: false, format: "single", kueri: [] };
    expect(await pickIdeaMedia(INPUT)).toBeNull();
    expect(fetched).toEqual([]);
    expect(mocks.hermes).toHaveBeenCalledTimes(1);
  });

  it("force: tetap mencari walau Hermes bilang tidak perlu", async () => {
    plan = { pakaiGambar: false, format: "single", visual: "warung kuliner malam", kueri: ["kuliner malam jakarta"] };
    const media = await pickIdeaMedia({ ...INPUT, force: true });
    expect(media?.type).toBe("IMAGE");
    expect(textOf(mocks.hermes.mock.calls[0][0].contents[0].parts[0])).toContain("pakaiGambar wajib true");
  });

  it("rencana tanpa gambaran foto ideal tidak sah", async () => {
    plan = { pakaiGambar: true, format: "single", visual: "", kueri: ["kuliner malam jakarta"] };
    expect(await pickIdeaMedia(INPUT)).toBeNull();
  });

  it("Hermes tidak tersedia untuk keputusan atau penilaian: null", async () => {
    plan = null;
    expect(await pickIdeaMedia(INPUT)).toBeNull();
    plan = { pakaiGambar: true, format: "single", visual: "warung kuliner malam", kueri: ["kuliner malam jakarta"] };
    scores = null;
    expect(await pickIdeaMedia(INPUT)).toBeNull();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("single: Hermes MELIHAT thumbnail tiap kandidat sah; foto skor tertinggi dipakai tanpa diunggah", async () => {
    scores = [7, 9];
    const media = await pickIdeaMedia(INPUT);
    expect(textOf(mocks.hermes.mock.calls[0][0].contents[0].parts[0])).toContain("Tema akun: Kuliner nusantara");
    // Berita keras tidak dibuka; gambar 320px (nasi goreng) gugur sebelum dinilai.
    expect(fetched).not.toContain("https://www.detik.com/news/2");
    expect(imagesSent()).toBe(2);
    expect(textOf(judgeParts[0])).toContain("FOTO IDEAL: suasana warung kuliner malam di Jakarta");
    const thumb = judgeParts.find((p) => "inlineData" in p) as { inlineData: { mimeType: string; data: string } };
    expect(thumb.inlineData.mimeType).toBe("image/jpeg");
    expect((await sharp(Buffer.from(thumb.inlineData.data, "base64")).metadata()).width).toBeLessThanOrEqual(384);
    const key = imageKeyOf("https://cdn.detik.net/pecel.jpg");
    expect(media).toEqual({
      type: "IMAGE",
      items: [
        {
          sourceUrl: "https://cdn.detik.net/pecel.jpg",
          credit: "food.detik.com",
          sourceKind: "NEWS",
          articleUrl: "https://food.detik.com/3",
          articleTitle: "Pecel lele Angel, warung legendaris yang buka sampai subuh",
          imageKey: key,
          width: 1080,
          height: 675,
        },
      ],
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remember).toHaveBeenCalledWith("acc1", [key], expect.any(Date));
  });

  it(`tidak ada foto dengan skor >= ${MIN_SCORE}: tanpa gambar (bukan dipaksakan)`, async () => {
    scores = [6, 3];
    expect(await pickIdeaMedia(INPUT)).toBeNull();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("gambar yang dikecualikan atau dipakai 30 hari terakhir tidak dinilai", async () => {
    mocks.used.mockResolvedValue(new Set([imageKeyOf("https://cdn.detik.net/pecel.jpg")]));
    const media = await pickIdeaMedia({ ...INPUT, exclude: [imageKeyOf("https://asset.kompas.com/gultik.jpg")] });
    const since = mocks.used.mock.calls[0][2] as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThan(29 * 24 * HOUR);
    expect(fetched).not.toContain("https://asset.kompas.com/gultik.jpg");
    expect(fetched).not.toContain("https://cdn.detik.net/pecel.jpg");
    // Sisa satu kandidat terlalu kecil dan Wikimedia kosong -> tidak ada yang dinilai.
    expect(media).toBeNull();
    expect(mocks.hermes).toHaveBeenCalledTimes(1);
  });

  it("carousel: foto berskor cukup jadi slide; satu saja yang lolos -> single", async () => {
    plan = { ...plan!, format: "carousel" };
    scores = [8, 9];
    const two = await pickIdeaMedia(INPUT);
    expect(two?.type).toBe("CAROUSEL");
    expect(two?.items.map((i) => i.credit)).toEqual(["food.detik.com", "kompas.com"]);
    mocks.used.mockResolvedValue(new Set());
    forgetNewsImageCache();
    scores = [8, 5];
    const one = await pickIdeaMedia(INPUT);
    expect(one?.type).toBe("IMAGE");
    expect(one?.items[0].sourceUrl).toBe("https://asset.kompas.com/gultik.jpg");
  });

  it("Wikimedia ikut dinilai bersama foto berita dan bisa menang", async () => {
    wikiRoute();
    scores = [5, 6, 9];
    const media = await pickIdeaMedia(INPUT);
    expect(imagesSent()).toBe(3);
    expect(media?.items[0]).toMatchObject({
      credit: "Wikimedia Commons",
      sourceKind: "WIKIMEDIA",
      articleUrl: "https://commons.wikimedia.org/wiki/File:Jakarta_street_food.jpg",
      imageKey: imageKeyOf("https://upload.wikimedia.org/a/street.jpg"),
      sourceUrl: "https://upload.wikimedia.org/thumb/street.jpg",
      width: 1080,
      height: 675,
    });
    expect(fetched.find((u) => u.startsWith("https://commons.wikimedia.org"))).toContain("Jakarta+street+food");
  });

  it("teks + kredit tidak muat: null tanpa dicatat", async () => {
    expect(await pickIdeaMedia({ ...INPUT, text: "a".repeat(495) })).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("dibatalkan pemanggil: null tanpa melempar", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    mocks.hermes.mockImplementation(async () => null);
    await expect(pickIdeaMedia({ ...INPUT, signal: ctrl.signal })).resolves.toBeNull();
  });
});
