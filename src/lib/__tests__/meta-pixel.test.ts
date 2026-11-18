import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("../supabase", () => ({ rpc: (...a: unknown[]) => rpcMock(...a), sqlTs: (d: Date) => d.toISOString().replace("Z", "") }));

import { capiPayload, forgetPixelConfig, pixelPatch, publicPixelId, savePixelConfig, sendServerEvent, toAdminDTO } from "../meta-pixel";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

describe("meta-pixel", () => {
  beforeEach(() => {
    forgetPixelConfig();
    rpcMock.mockReset();
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("validates the admin form", () => {
    expect(pixelPatch({ pixelId: "1234 5678 9012 345", enabled: true })).toEqual({ ok: true, patch: { pixelId: "123456789012345", enabled: true } });
    expect(pixelPatch({ pixelId: "abc" })).toMatchObject({ ok: false, status: 400 });
    expect(pixelPatch({ testEventCode: "test123" })).toEqual({ ok: true, patch: { testEventCode: "TEST123" } });
    expect(pixelPatch({ testEventCode: "hello" })).toMatchObject({ ok: false });
    // Token kosong = tidak diubah; hapus hanya lewat clearAccessToken.
    expect(pixelPatch({ accessToken: "  " })).toEqual({ ok: true, patch: {} });
    expect(pixelPatch({ clearAccessToken: true })).toEqual({ ok: true, patch: { accessToken: "" } });
    expect(pixelPatch({ accessToken: "short" })).toMatchObject({ ok: false });
  });

  it("serves the pixel id only when enabled", async () => {
    rpcMock.mockResolvedValueOnce({ enabled: false, pixelId: "123456789012345" });
    expect(await publicPixelId()).toBeNull();
    forgetPixelConfig();
    rpcMock.mockResolvedValueOnce({ enabled: true, pixelId: "123456789012345" });
    expect(await publicPixelId()).toBe("123456789012345");
  });

  it("falls back to env when the column is missing", async () => {
    rpcMock.mockRejectedValue(new Error("function dash_pixel_config does not exist"));
    process.env.META_PIXEL_ID = "987654321098765";
    expect(await publicPixelId()).toBe("987654321098765");
  });

  it("masks the token for the admin console", () => {
    const dto = toAdminDTO({ stored: true, enabled: true, pixelId: "123456789012345", accessToken: "EAAGabcdefghijklmnopqrstuvwxyz1234", testEventCode: "", source: "database" });
    expect(dto).toMatchObject({ live: true, hasAccessToken: true });
    expect(dto.accessTokenMasked).not.toContain("abcdef");
    expect(JSON.stringify(dto)).not.toContain("EAAGabcdefghijklmnopqrstuvwxyz1234");
  });

  it("refuses to switch on without a pixel id", async () => {
    rpcMock.mockResolvedValueOnce({});
    expect(await savePixelConfig("admin", { enabled: true })).toMatchObject({ ok: false, status: 400 });
  });

  it("hashes the email and keeps the event id for deduplication", () => {
    const body = capiPayload(
      { eventName: "CompleteRegistration", eventId: "e-1", sourceUrl: "https://bottrit.com/daftar", email: " Rina@Mail.com ", ip: "1.2.3.4", userAgent: "UA", now: new Date(1_700_000_000_000) },
      "TEST1"
    ) as { data: Record<string, unknown>[]; test_event_code: string };
    const ev = body.data[0];
    expect(ev).toMatchObject({ event_name: "CompleteRegistration", event_id: "e-1", event_time: 1_700_000_000, action_source: "website" });
    expect(ev.user_data).toEqual({ em: [sha("rina@mail.com")], client_ip_address: "1.2.3.4", client_user_agent: "UA" });
    expect(JSON.stringify(body)).not.toContain("Rina@Mail.com");
    expect(body.test_event_code).toBe("TEST1");
  });

  it("sends to the Graph API and never throws", async () => {
    rpcMock.mockResolvedValue({ enabled: true, pixelId: "123456789012345", accessToken: "EAAGabcdefghijklmnopqrstuvwxyz1234" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendServerEvent({ eventName: "PageView", eventId: "x", sourceUrl: "https://bottrit.com/" })).toEqual({ ok: true, received: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/123456789012345/events?access_token=");

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await sendServerEvent({ eventName: "PageView", eventId: "y", sourceUrl: "https://bottrit.com/" })).toMatchObject({ ok: false });
  });

  it("skips the server event when no token is set", async () => {
    rpcMock.mockResolvedValue({ enabled: true, pixelId: "123456789012345" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendServerEvent({ eventName: "PageView", eventId: "x", sourceUrl: "https://bottrit.com/" })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
