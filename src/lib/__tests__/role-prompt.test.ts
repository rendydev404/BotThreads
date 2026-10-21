import { describe, expect, it } from "vitest";
import { isRolePromptRequest } from "../role-prompt";

describe("isRolePromptRequest", () => {
  it.each([
    "Buatkan prompt peran yang lengkap untuk akun saya",
    "buatin prompt role buat @rendy.dev404",
    "tolong susun system prompt untuk akun ini",
    "kasih saran persona akun gue dong",
    "bikinin prompt buat akun saya biar hasilnya maksimal",
    "perbaiki profil ai @akun_a",
  ])("mengenali: %s", (t) => expect(isRolePromptRequest(t)).toBe(true));

  it.each([
    "Buat 3 draf postingan untuk besok",
    "buatkan postingan tentang prompt gambar AI",
    "bikin prompt midjourney buat foto produk",
    "Ringkasan performa 7 hari terakhir",
    "apa itu prompt?",
  ])("bukan prompt peran: %s", (t) => expect(isRolePromptRequest(t)).toBe(false));
});
