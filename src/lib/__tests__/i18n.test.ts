import { describe, expect, it } from "vitest";
import { interpolate, makeT, parseLang, translate } from "@/lib/i18n/core";
import en from "@/lib/i18n/en";

describe("i18n core", () => {
  it("falls back to the Indonesian source for ID and for missing keys", () => {
    const dict = { Simpan: "Save" };
    expect(makeT("id", dict)("Simpan")).toBe("Simpan");
    expect(makeT("en", dict)("Simpan")).toBe("Save");
    expect(makeT("en", dict)("Belum ada terjemahan")).toBe("Belum ada terjemahan");
  });

  it("interpolates variables and keeps unknown placeholders", () => {
    expect(interpolate("Dibalas {n} komentar", { n: 3 })).toBe("Dibalas 3 komentar");
    expect(interpolate("Halo {nama}", {})).toBe("Halo {nama}");
  });

  it("picks the English plural form from n", () => {
    const dict = { "{n} akun": "{n} account||{n} accounts" };
    expect(translate(dict, "{n} akun", { n: 1 })).toBe("1 account");
    expect(translate(dict, "{n} akun", { n: 4 })).toBe("4 accounts");
  });

  it("strips the @@context marker in the Indonesian fallback", () => {
    const dict = { "Selesai@@tanggal": "End", Selesai: "Done" };
    expect(makeT("id", dict)("Selesai@@tanggal")).toBe("Selesai");
    expect(makeT("en", dict)("Selesai@@tanggal")).toBe("End");
    expect(makeT("en", dict)("Selesai")).toBe("Done");
  });

  it("parses the cookie value safely", () => {
    expect(parseLang("en")).toBe("en");
    expect(parseLang("fr")).toBe("id");
    expect(parseLang(undefined)).toBe("id");
  });
});

describe("EN dictionary", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("has no empty translations", () => {
    const empty = Object.entries(en).filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("keeps the same placeholders as the Indonesian key", () => {
    const bad = Object.entries(en)
      .filter(([k, v]) => v.split("||").some((form) => {
        const want = placeholders(k);
        const got = placeholders(form);
        // Bentuk tunggal boleh menulis angka "1"/"one" alih-alih {n}.
        return got.some((p) => !want.includes(p)) || want.filter((p) => p !== "n").some((p) => !got.includes(p));
      }))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
