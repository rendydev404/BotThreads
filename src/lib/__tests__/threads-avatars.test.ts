import { describe, expect, it } from "vitest";
import { avatarExpiresAt, dueAvatars } from "../threads-avatars";

const cdn = (oeSeconds: number) =>
  `https://scontent-cgk2-1.cdninstagram.com/v/t51.82787-19/x_n.jpg?_nc_cat=110&oh=00_abc&oe=${oeSeconds.toString(16).toUpperCase()}`;

describe("avatarExpiresAt", () => {
  it("membaca oe (detik epoch heksadesimal) dari URL CDN Meta", () => {
    expect(avatarExpiresAt(cdn(0x6a0f4cf9))).toBe(0x6a0f4cf9 * 1000);
  });

  it("null bila URL kosong, tidak valid, atau tidak bertanda waktu", () => {
    expect(avatarExpiresAt(null)).toBeNull();
    expect(avatarExpiresAt("bukan url")).toBeNull();
    expect(avatarExpiresAt("https://contoh.id/foto.jpg")).toBeNull();
    expect(avatarExpiresAt("https://contoh.id/foto.jpg?oe=zzz")).toBeNull();
  });
});

describe("dueAvatars", () => {
  const now = Date.UTC(2026, 9, 16, 8, 0);
  const sec = (ms: number) => Math.floor(ms / 1000);
  const rows = [
    { id: "segar", avatarUrl: cdn(sec(now + 3 * 86_400_000)) },
    { id: "besok", avatarUrl: cdn(sec(now + 12 * 3_600_000)) },
    { id: "mati", avatarUrl: cdn(sec(now - 4 * 86_400_000)) },
    { id: "kosong", avatarUrl: null },
    { id: "tanpa-oe", avatarUrl: "https://contoh.id/foto.jpg" },
  ];

  it("memilih yang sudah/akan kedaluwarsa dalam 24 jam, paling mendesak dulu", () => {
    expect(dueAvatars(rows, now)).toEqual(["mati", "besok"]);
  });

  it("menghormati batas per putaran", () => {
    expect(dueAvatars(rows, now, 1)).toEqual(["mati"]);
  });
});
