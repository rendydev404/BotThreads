import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  deltaTone,
  isTableStart,
  numericColumns,
  parseBars,
  parseCallout,
  parseStats,
  parseTable,
  richBlocksPlainText,
  toNumber,
} from "../rich-blocks";
import { Markdown } from "@/components/chat/markdown";

describe("toNumber", () => {
  it("membaca format id-ID", () => {
    expect(toNumber("45.308")).toBe(45308);
    expect(toNumber("1.234.567")).toBe(1234567);
    expect(toNumber("12,5%")).toBe(12.5);
    expect(toNumber("Rp 1.200.000")).toBe(1200000);
    expect(toNumber("609 views")).toBe(609);
    expect(toNumber("-13%")).toBe(-13);
  });
  it("null bila tidak ada angka", () => {
    expect(toNumber("n/a")).toBeNull();
  });
});

describe("deltaTone", () => {
  it("membedakan naik, turun, dan netral", () => {
    expect(deltaTone("+452%")).toBe("up");
    expect(deltaTone("naik 13%")).toBe("up");
    expect(deltaTone("-13%")).toBe("down");
    expect(deltaTone("turun 2%")).toBe("down");
    expect(deltaTone("32 akun")).toBe("flat");
    expect(deltaTone(undefined)).toBe("flat");
  });
});

describe("parseBars", () => {
  it("judul, baris, rasio relatif ke nilai terbesar, catatan opsional", () => {
    const d = parseBars("Views 7 hari\n@a | 45.308 | +452%\n@b | 22.654\n");
    expect(d?.title).toBe("Views 7 hari");
    expect(d?.percent).toBe(false);
    expect(d?.rows).toHaveLength(2);
    expect(d?.rows[0]).toMatchObject({ label: "@a", valueText: "45.308", value: 45308, ratio: 1, note: "+452%" });
    expect(d?.rows[1].ratio).toBeCloseTo(0.5);
  });

  it("semua persen: skala 0-100", () => {
    const d = parseBars("@a | 40%\n@b | 10%");
    expect(d?.percent).toBe(true);
    expect(d?.rows[0].ratio).toBeCloseTo(0.4);
  });

  it("baris tanpa angka dilewati; kosong menghasilkan null", () => {
    expect(parseBars("@a | tidak ada\n@b | 5")?.rows).toHaveLength(1);
    expect(parseBars("hanya judul")).toBeNull();
  });
});

describe("parseStats", () => {
  it("label, nilai, catatan", () => {
    expect(parseStats("Total views | 260.926 | +18%\nAkun aktif | 32\ntanpa pipa")).toEqual([
      { label: "Total views", value: "260.926", note: "+18%" },
      { label: "Akun aktif", value: "32", note: undefined },
    ]);
  });
});

describe("tabel GFM", () => {
  const src = ["| Akun | Views | Perubahan |", "|:--|--:|--:|", "| @a | 45.308 | +452% |", "| @b | 12.100 | -13% |", "", "sesudah"];

  it("mendeteksi awal tabel dan membaca sampai baris kosong", () => {
    expect(isTableStart(src[0], src[1])).toBe(true);
    expect(isTableStart("kalimat biasa | dengan pipa", "baris lain")).toBe(false);
    const { table, next } = parseTable(src, 0);
    expect(table.header).toEqual(["Akun", "Views", "Perubahan"]);
    expect(table.align).toEqual(["left", "right", "right"]);
    expect(table.rows).toEqual([
      ["@a", "45.308", "+452%"],
      ["@b", "12.100", "-13%"],
    ]);
    expect(next).toBe(4);
    expect(numericColumns(table)).toEqual([false, true, true]);
  });
});

describe("parseCallout", () => {
  it("mengenali jenis, judul, dan isi", () => {
    expect(parseCallout("[!IMPORTANT] Temuan utama\nDua akun menopang 45% views.")).toEqual({
      kind: "key",
      title: "Temuan utama",
      body: "Dua akun menopang 45% views.",
    });
    expect(parseCallout("[!TIP]\nCoba jam 09:00")).toMatchObject({ kind: "tip", title: "Saran", body: "Coba jam 09:00" });
  });
  it("kutipan biasa bukan callout", () => {
    expect(parseCallout("hanya kutipan")).toBeNull();
    expect(parseCallout("[!ASING] x")).toBeNull();
  });
});

describe("richBlocksPlainText", () => {
  it("mengubah bar dan stat jadi teks polos untuk Salin", () => {
    const out = richBlocksPlainText("Intro\n```bar\nViews\n@a | 10 | +5%\n```\n```stat\nTotal | 99\n```");
    expect(out).toContain("Views\n@a: 10 (+5%)");
    expect(out).toContain("Total: 99");
    expect(out).not.toContain("```");
  });
});

describe("Markdown (render)", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

  it("judul bertingkat, tabel, bar, stat, dan callout", () => {
    const out = html(
      [
        "## Dua akun menopang jaringan",
        "Ringkasan satu kalimat.",
        "",
        "```stat",
        "Total views | 260.926 | +18%",
        "```",
        "",
        "### Peringkat",
        "| Akun | Views | Perubahan |",
        "| --- | ---: | ---: |",
        "| @a | 45.308 | +452% |",
        "",
        "```bar",
        "Views",
        "@a | 45.308",
        "```",
        "",
        "> [!WARNING] Perhatian",
        "> Sampel kecil.",
      ].join("\n")
    );
    expect(out).toContain("<h3");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<dl");
    expect(out).toContain("260.926");
    expect(out).toContain("bar-grow");
    expect(out).toContain("<aside");
    expect(out).toContain("Sampel kecil.");
  });

  it("teks biasa dan daftar tetap berfungsi", () => {
    const out = html("Halo **dunia**\n\n- satu\n- dua");
    expect(out).toContain("<strong");
    expect(out).toContain("<ul");
  });

  it("blok bar tanpa data valid jatuh ke blok kode biasa", () => {
    expect(html("```bar\ntidak ada angka\n```")).toContain("<pre");
  });
});
