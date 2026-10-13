import { describe, expect, it } from "vitest";
import { isExecuteIntent, normalizePlan, pickAdviceText } from "../action-plan";

const ADVICE = "## Langkah yang disarankan\n1. Geser posting ke jam 09:00.\n2. Tiru pola @akbaralatas. ".repeat(4);

describe("isExecuteIntent", () => {
  it("mengenali perintah mengerjakan saran", () => {
    for (const t of [
      "Kerjakan saran tadi secara otomatis",
      "kerjakan saran ini otomatis",
      "Jalankan rekomendasi yang kamu berikan",
      "eksekusi langkah itu",
      "Terapkan strategi tadi",
      "kerjain semuanya",
    ]) {
      expect(isExecuteIntent(t, ADVICE), t).toBe(true);
    }
  });

  it("konfirmasi singkat hanya bila jawaban sebelumnya memuat saran", () => {
    expect(isExecuteIntent("ya kerjakan aja", ADVICE)).toBe(true);
    expect(isExecuteIntent("gas kerjakan", "Ringkasan angka saja.")).toBe(false);
  });

  it("pertanyaan dan permintaan lain tidak memicu eksekusi", () => {
    for (const t of [
      "Apa langkah yang harus saya lakukan untuk strategi ini?",
      "Bagaimana cara menerapkan saran itu?",
      "Buat 3 draf postingan untuk besok",
      "Jadwalkan 3 post minggu ini",
      "Ubah draf tadi jadi lebih singkat",
      "jalankan orchestrator untuk semua akun",
      "Ringkasan performa 7 hari terakhir",
      "gpp posting aja",
    ]) {
      expect(isExecuteIntent(t, ADVICE), t).toBe(false);
    }
  });
});

describe("pickAdviceText", () => {
  it("memilih jawaban bot terbaru yang cukup panjang", () => {
    const hist = [
      { sender: "user", text: "tanya" },
      { sender: "bot", text: ADVICE },
      { sender: "user", text: "ok" },
      { sender: "bot", text: "Siap." },
    ];
    expect(pickAdviceText(hist)).toBe(ADVICE.slice(0, 6000));
  });
  it("kosong bila tidak ada jawaban bot", () => {
    expect(pickAdviceText([{ sender: "user", text: "halo" }])).toBe("");
  });
});

describe("normalizePlan", () => {
  const accounts = [
    { id: "a1", username: "akbaralatas", displayName: "Akbar" },
    { id: "a2", username: "sukashawarmabeji", displayName: "Beji" },
  ];

  it("memetakan username ke id, mengabaikan @ dan huruf besar", () => {
    const r = normalizePlan(
      {
        tasks: [{ title: "Tiru pola akun naik", accounts: ["@AkbarAlatas"], topic: "Prompt AI praktis", reason: "Naik 452%" }],
      },
      accounts
    );
    expect(r.tasks).toEqual([
      { title: "Tiru pola akun naik", topic: "Prompt AI praktis", reason: "Naik 452%", accountIds: ["a1"], accountNames: ["akbaralatas"] },
    ]);
  });

  it("akun kosong berarti semua akun; akun asing membuat tugas dilewati", () => {
    const r = normalizePlan(
      {
        tasks: [
          { title: "Untuk semua", accounts: [], topic: "Cerita pelanggan", reason: "" },
          { title: "Akun gaib", accounts: ["tidakada"], topic: "x", reason: "" },
        ],
      },
      accounts
    );
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].accountIds).toBeNull();
  });

  it("maksimal 3 tugas dan membuang tugas tanpa judul atau topik", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, accounts: [], topic: `topik ${i}`, reason: "" }));
    expect(normalizePlan({ tasks: [{ title: "", topic: "x", accounts: [] }, ...many] }, accounts).tasks).toHaveLength(3);
  });

  it("tanpa tugas: meneruskan alasan notExecutable; masukan rusak aman", () => {
    expect(normalizePlan({ tasks: [], notExecutable: "Hanya soal frekuensi." }, accounts)).toEqual({
      tasks: [],
      notExecutable: "Hanya soal frekuensi.",
    });
    expect(normalizePlan(null, accounts).tasks).toEqual([]);
    expect(normalizePlan("rusak", accounts).tasks).toEqual([]);
  });
});
