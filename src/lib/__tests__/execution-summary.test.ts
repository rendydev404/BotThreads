import { describe, expect, it } from "vitest";
import {
  composeExecutionMessage,
  countExecution,
  executionMarkdown,
  fallbackClosing,
  parseExecution,
  type Execution,
} from "../execution-summary";
import { parseBars, parseCallout, parseStats } from "../rich-blocks";
import { queueText } from "../queue-context";
import type { PostItemDTO } from "../content-types";

const exec: Execution = {
  publish: "schedule",
  tasks: [
    {
      title: "Tiru pola akun naik",
      topic: "Prompt AI praktis",
      accounts: [
        { username: "akunA", status: "SCHEDULED", at: "2026-10-14T02:00:00.000Z", text: "Prompt | ini `siap` salin", error: null, moved: false },
        { username: "akunB", status: "SCHEDULED", at: "2026-10-14T07:00:00.000Z", text: "Teks B", error: null, moved: true },
        { username: "akunC", status: "FAILED", at: null, text: "", error: "Akun belum terhubung", moved: false },
      ],
    },
    { title: "Tugas kosong", topic: "", accounts: [] },
  ],
};

describe("parseExecution", () => {
  it("menormalkan payload dan membuang yang rusak", () => {
    const r = parseExecution({
      publish: "now",
      tasks: [
        { title: " T1 ", topic: "x", accounts: [{ username: "@a", status: "SCHEDULED", at: "2026-10-14T02:00:00Z", text: "isi" }, { username: "", status: "FAILED" }, 5] },
        { title: "", accounts: [] },
        "bukan objek",
      ],
    });
    expect(r?.publish).toBe("now");
    expect(r?.tasks).toHaveLength(1);
    expect(r?.tasks[0].title).toBe("T1");
    expect(r?.tasks[0].accounts).toEqual([
      { username: "a", status: "SCHEDULED", at: "2026-10-14T02:00:00.000Z", text: "isi", error: null, moved: false },
    ]);
  });

  it("null untuk masukan tidak valid; status asing menjadi SKIPPED", () => {
    expect(parseExecution(null)).toBeNull();
    expect(parseExecution({ tasks: "x" })).toBeNull();
    expect(parseExecution({ tasks: [] })).toBeNull();
    expect(parseExecution({ tasks: [{ title: "T", accounts: [{ username: "z", status: "???" }] }] })?.tasks[0].accounts[0].status).toBe("SKIPPED");
  });
});

describe("executionMarkdown", () => {
  it("menghitung hasil dan menyusun judul, stat, serta tabel per tugas", () => {
    expect(countExecution(exec)).toEqual({ scheduled: 2, failed: 1, skipped: 0, drafts: 0 });
    const md = executionMarkdown(exec);
    expect(md).toContain("## Selesai: 2 tugas dikerjakan otomatis");
    expect(md).toMatch(/Masuk antrean \| 2 \| Dijadwalkan di jam ramai/);
    expect(md).toContain("Gagal | 1");
    expect(md).toContain("### 1. Tiru pola akun naik");
    expect(md).toContain("| @akunB | Terjadwal (digeser) |");
    expect(md).toContain("Akun belum terhubung");
    expect(md).toContain("Tidak ada akun yang menghasilkan posting");
  });

  it("karakter pipa dan backtick pada isi tidak merusak tabel", () => {
    const md = executionMarkdown(exec);
    const row = md.split("\n").find((l) => l.startsWith("| @akunA"))!;
    expect(row).toContain("Prompt \\| ini 'siap' salin");
    expect(md).not.toMatch(/`siap`/);
  });

  it("blok stat bisa dibaca kembali oleh parser UI", () => {
    const stat = /```stat\n([\s\S]*?)\n```/.exec(executionMarkdown(exec))![1];
    expect(parseStats(stat).map((s) => s.label)).toEqual(["Masuk antrean", "Gagal", "Tugas"]);
    expect(parseBars("A | 1")).not.toBeNull();
  });

  it("tanpa satu pun antrean: judul jujur", () => {
    const none: Execution = { publish: "schedule", tasks: [{ title: "T", topic: "", accounts: [{ username: "a", status: "FAILED", at: null, text: "", error: "x", moved: false }] }] };
    expect(executionMarkdown(none)).toContain("belum ada yang masuk antrean");
  });
});

describe("penutup", () => {
  it("cadangan menyebut jumlah, gagal, dan langkah pantau", () => {
    const c = fallbackClosing(exec);
    expect(c).toContain("2 posting");
    expect(c).toContain("1 akun gagal");
    expect(c).toContain("24 jam");
  });

  it("pesan akhir: ringkasan + callout penutup yang bisa dikenali parser", () => {
    const msg = composeExecutionMessage(exec, "Baris satu.\nBaris dua.");
    const quote = msg.slice(msg.indexOf("> [!TIP]")).replace(/^> ?/gm, "");
    const c = parseCallout(quote);
    expect(c).toMatchObject({ kind: "tip", title: "Penutup" });
    expect(c?.body).toContain("Baris satu.");
  });
});

describe("queueText", () => {
  const post = (over: Partial<PostItemDTO>): PostItemDTO => ({
    id: "p",
    dispatchId: "d",
    text: "Isi postingan",
    topicTag: null,
    tayangPada: "2026-10-14T02:00:00.000Z",
    status: "SCHEDULED",
    statusLabel: "Terjadwal",
    pesanError: null,
    releaseUrl: null,
    account: { id: "a", username: "akunA", displayName: "A", avatarUrl: null },
    outletNama: null,
    mine: true,
    editable: true,
    cancellable: true,
    retryable: false,
    ...over,
  });

  it("memuat jadwal dan riwayat, atau penanda kosong", () => {
    const t = queueText([post({})], [post({ status: "FAILED", statusLabel: "Gagal", pesanError: "Sesi berakhir" })]);
    expect(t).toContain("Terjadwal atau mengantre (1)");
    expect(t).toContain("@akunA | 14 Okt 2026, 09.00 WIB | Terjadwal");
    expect(t).toContain("Gagal (Sesi berakhir)");
    expect(queueText([], [])).toContain("- tidak ada");
  });
});
