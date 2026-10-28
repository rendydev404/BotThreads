import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ db: () => ({}), rpc: vi.fn(), sqlTs: (d: Date) => d.toISOString().replace("Z", ""), toDate: (s: string) => new Date(s) }));
vi.mock("../threads-publisher", () => ({ accessTokenFor: vi.fn() }));
vi.mock("../threads-replies", () => ({ ingestWebhook: vi.fn() }));

import { WEBHOOK_QUIET_MS, duePolls, pollIntervalMs, toWebhookReply, type PollTarget } from "../threads-reply-poll";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-28T07:00:00Z");
const target = (mediaId: string, ageMs: number, accountId = "a1"): PollTarget => ({ mediaId, accountId, postedAt: new Date(NOW - ageMs) });

describe("pollIntervalMs", () => {
  it("makin tua postingan makin jarang dicek, berhenti setelah 3 hari", () => {
    expect(pollIntervalMs(0)).toBe(5 * MIN);
    expect(pollIntervalMs(5 * HOUR)).toBe(5 * MIN);
    expect(pollIntervalMs(6 * HOUR)).toBe(15 * MIN);
    expect(pollIntervalMs(23 * HOUR)).toBe(15 * MIN);
    expect(pollIntervalMs(24 * HOUR)).toBe(HOUR);
    expect(pollIntervalMs(71 * HOUR)).toBe(HOUR);
    expect(pollIntervalMs(72 * HOUR)).toBeNull();
  });
});

describe("duePolls", () => {
  it("belum pernah dicek = langsung; baru dicek = menunggu jedanya", () => {
    const polled = new Map([["m2", NOW - 2 * MIN]]);
    const due = duePolls([target("m1", HOUR), target("m2", HOUR)], NOW, polled, new Map());
    expect(due.map((t) => t.mediaId)).toEqual(["m1"]);
  });

  it("postingan 2 hari: dicek lagi setelah 1 jam, bukan 5 menit", () => {
    const polled = new Map([["m1", NOW - 30 * MIN]]);
    expect(duePolls([target("m1", 48 * HOUR)], NOW, polled, new Map())).toEqual([]);
    polled.set("m1", NOW - 61 * MIN);
    expect(duePolls([target("m1", 48 * HOUR)], NOW, polled, new Map())).toHaveLength(1);
  });

  it("akun yang sudah menerima webhook dalam 24 jam tidak di-polling (berhenti sendiri)", () => {
    const seen = new Map([["a1", NOW - HOUR]]);
    expect(duePolls([target("m1", HOUR, "a1"), target("m2", HOUR, "a2")], NOW, new Map(), seen).map((t) => t.mediaId)).toEqual(["m2"]);
    seen.set("a1", NOW - WEBHOOK_QUIET_MS - MIN);
    expect(duePolls([target("m1", HOUR, "a1")], NOW, new Map(), seen)).toHaveLength(1);
  });

  it("dibatasi per putaran, yang paling lama terlambat dulu, di luar 3 hari diabaikan", () => {
    const polled = new Map([
      ["baru", NOW - 6 * MIN],
      ["lama", NOW - 50 * MIN],
    ]);
    const due = duePolls([target("baru", HOUR), target("lama", HOUR), target("basi", 80 * HOUR)], NOW, polled, new Map(), 1);
    expect(due.map((t) => t.mediaId)).toEqual(["lama"]);
  });
});

describe("toWebhookReply", () => {
  it("balasan orang lain jadi item webhook; balasan ke balasan kita membawa repliedTo", () => {
    expect(
      toWebhookReply("m1", { id: "c1", text: " halo ", username: "warga", timestamp: "2026-10-28T06:00:00+0000", replied_to: { id: "m1" }, root_post: { id: "m1" } })
    ).toEqual({ mediaId: "m1", commentId: "c1", repliedTo: null, username: "warga", text: "halo", commentedAt: "2026-10-28T06:00:00.000" });
    expect(toWebhookReply("m1", { id: "c2", text: "lagi", username: "warga", replied_to: { id: "r9" } })?.repliedTo).toBe("r9");
  });

  it("balasan milik akun sendiri atau tanpa id dilewati", () => {
    expect(toWebhookReply("m1", { id: "c3", is_reply_owned_by_me: true })).toBeNull();
    expect(toWebhookReply("m1", { text: "x" })).toBeNull();
  });
});
