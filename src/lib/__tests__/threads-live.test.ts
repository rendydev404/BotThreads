import { describe, expect, it } from "vitest";
import { withPostFloor, type LiveAccount, type LivePostMetrics } from "../threads-live";

const account = (over: Partial<LiveAccount> = {}): LiveAccount => ({
  accountId: "a1",
  views: 1300,
  likes: 0,
  replies: 0,
  reposts: 0,
  quotes: 0,
  followers: 1,
  posts: [
    { id: "p1", accountId: "a1", mediaType: "TEXT_POST", text: "satu", permalink: null, postedAt: new Date("2026-10-20T01:00:00Z") },
    { id: "p2", accountId: "a1", mediaType: "TEXT_POST", text: "dua", permalink: null, postedAt: new Date("2026-10-20T02:00:00Z") },
  ],
  ...over,
});
const m = (likes: number, replies: number, reposts = 0, views = 0): LivePostMetrics => ({ views, likes, replies, reposts });

describe("withPostFloor", () => {
  it("insights akun hari ini masih 0: interaksi diambil dari postingan yang terbit hari ini", () => {
    const out = withPostFloor(account(), new Map([["p1", m(11, 27, 1, 449)], ["p2", m(2, 3)]]));
    expect(out).toMatchObject({ likes: 13, replies: 30, reposts: 1, views: 1300 });
  });

  it("insights akun lebih besar (interaksi di postingan lama ikut terhitung): tetap dipakai", () => {
    const out = withPostFloor(account({ likes: 50, replies: 10, reposts: 4 }), new Map([["p1", m(11, 27, 1)]]));
    expect(out).toMatchObject({ likes: 50, replies: 27, reposts: 4 });
  });

  it("tanpa metrik postingan: angka akun apa adanya, objek asal tidak diubah", () => {
    const a = account({ likes: 3 });
    expect(withPostFloor(a, new Map())).toMatchObject({ likes: 3, replies: 0, reposts: 0 });
    expect(a.likes).toBe(3);
  });
});
