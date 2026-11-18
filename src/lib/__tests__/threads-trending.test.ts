import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../integrations", () => ({
  getRawIntegrations: async () => ({ threadsOauth: { enabled: true, appId: "123", appSecret: "sec", source: "env" } }),
}));

import { POSTS_TTL_MS, TOPICS_TTL_MS, forgetTrending, isTrendId, toPosts, toTopics, trendPosts, trendingTopics } from "../threads-trending";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("threads-trending", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    forgetTrending();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parses topics and drops invalid rows", () => {
    expect(
      toTopics({
        trends: [
          { title: "Game Awards", description: " GTA VI leads ", trend_id: "1819984399064669" },
          { title: "No id" },
          { title: "", trend_id: "1" },
          { title: "Numeric", trend_id: 42 },
        ],
      })
    ).toEqual([
      { trendId: "1819984399064669", title: "Game Awards", description: "GTA VI leads" },
      { trendId: "42", title: "Numeric", description: null },
    ]);
    expect(toTopics(null)).toEqual([]);
  });

  it("parses posts", () => {
    expect(toPosts({ data: [{ id: "9", username: "a", text: "hi", media_type: "TEXT_POST", permalink: "https://t/9" }, { text: "x" }] })).toEqual([
      { id: "9", username: "a", text: "hi", mediaType: "TEXT_POST", permalink: "https://t/9", timestamp: null },
    ]);
  });

  it("validates trend ids", () => {
    expect(isTrendId("1802151381046935")).toBe(true);
    expect(isTrendId("12/../me")).toBe(false);
    expect(isTrendId("")).toBe(false);
  });

  it("calls /trending_topics with the app token and caches for an hour", async () => {
    fetchMock.mockResolvedValue(json({ trends: [{ title: "A", description: "d", trend_id: "1" }] }));
    let now = 1_000_000;
    const clock = () => now;
    const a = await trendingTopics("US", clock);
    expect(a).toMatchObject({ ok: true, country: "US", topics: [{ trendId: "1", title: "A" }] });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v1.0/trending_topics");
    expect(url.searchParams.get("country_code")).toBe("US");
    expect(url.searchParams.get("access_token")).toBe("TH|123|sec");

    now += TOPICS_TTL_MS - 1;
    await trendingTopics("US", clock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 2;
    await trendingTopics("US", clock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    fetchMock.mockResolvedValue(json({ trends: [] }));
    fetchMock.mockResolvedValue(json({ trends: [{ title: "A", trend_id: "1" }] }));
    await Promise.all([trendingTopics("US"), trendingTopics("US"), trendingTopics("US")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to US trends while Threads returns nothing for Indonesia", async () => {
    fetchMock.mockImplementation(async (u: string) =>
      new URL(u).searchParams.get("country_code") === "ID" ? json({}) : json({ trends: [{ title: "US trend", trend_id: "5" }] })
    );
    const r = await trendingTopics("ID");
    expect(r).toMatchObject({ ok: true, country: "US", fallbackFrom: "ID", topics: [{ title: "US trend" }] });
    // Both countries are cached for an hour: no extra calls.
    await trendingTopics("ID");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses Indonesian trends as soon as Threads provides them", async () => {
    fetchMock.mockResolvedValue(json({ trends: [{ title: "Tren ID", trend_id: "8" }] }));
    const r = await trendingTopics("ID");
    expect(r).toMatchObject({ ok: true, country: "ID", fallbackFrom: null, topics: [{ title: "Tren ID" }] });
    // The fallback country is fetched in parallel (once per hour), then both stay cached.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await trendingTopics("ID");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves stale topics when a refresh fails and backs off", async () => {
    let now = 0;
    const clock = () => now;
    fetchMock.mockResolvedValueOnce(json({ trends: [{ title: "Old", trend_id: "7" }] }));
    await trendingTopics("US", clock);
    now += TOPICS_TTL_MS + 1;
    fetchMock.mockResolvedValueOnce(json({ error: { message: "boom", code: 1 } }, 500));
    const stale = await trendingTopics("US", clock);
    expect(stale).toMatchObject({ ok: true, topics: [{ title: "Old" }] });
    await trendingTopics("US", clock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error without data and does not retry immediately", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(json({ error: { message: "down" } }, 500));
    expect(await trendingTopics("US")).toMatchObject({ ok: false, status: 502 });
    expect(await trendingTopics("US")).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports approved:false when the feature is not approved (403 / code 10)", async () => {
    fetchMock.mockResolvedValue(json({ error: { message: "Application does not have permission for this action", code: 10 } }, 403));
    const r = await trendPosts("1802151381046935", "top");
    expect(r).toMatchObject({ ok: true, approved: false, posts: [] });
    await trendPosts("1802151381046935", "top");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches trend posts with fields and caches per type", async () => {
    let now = 0;
    const clock = () => now;
    fetchMock.mockResolvedValue(json({ data: [{ id: "5", username: "u", text: "t", permalink: "p" }] }));
    const r = await trendPosts("99", "recent", clock);
    expect(r).toMatchObject({ ok: true, approved: true, posts: [{ id: "5" }] });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v1.0/99/posts");
    expect(url.searchParams.get("trending_post_type")).toBe("recent");
    expect(url.searchParams.get("fields")).toContain("permalink");
    await trendPosts("99", "top", clock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now += POSTS_TTL_MS - 1;
    await trendPosts("99", "recent", clock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
