/**
 * Hubungkan akun Threads lewat komputer dengan scan QR (opsional, untuk HP yang membajak halaman izin Threads ke
 * aplikasinya). Komputer membuat pairing dan menampilkan QR ke /hubungkan/<id>; Pemilik/Admin men-scan dengan HP
 * yang sudah masuk dashboard lalu menyetujui; komputer (memegang `pollToken`) lalu diantar ke halaman izin Meta.
 *
 * Disimpan di memori proses (seperti throttle.ts), cukup untuk satu instance dashboard: umur pendek, sekali pakai.
 * Komputer tidak pernah mendapat akses dashboard, hanya alamat izin Threads untuk workspace yang menyetujui.
 */
import { randomBytes } from "node:crypto";
import { encode } from "uqr";

export const PAIRING_TTL_MS = 10 * 60_000;
const MAX_PAIRINGS = 5_000;

export type PairingStatus = "menunggu" | "disetujui" | "ditolak" | "dipakai";

export interface PairingApproval {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  approverName: string;
}

interface Pairing {
  id: string;
  pollToken: string;
  expiresAt: number;
  status: PairingStatus;
  approval: PairingApproval | null;
}

interface Store {
  byId: Map<string, Pairing>;
  byToken: Map<string, Pairing>;
}

// Satu penyimpanan per proses walau modul dimuat di beberapa bundel route.
const KEY = Symbol.for("botthreads.threadsPairing");
const store = ((globalThis as Record<symbol, Store | undefined>)[KEY] ??= { byId: new Map(), byToken: new Map() });

const PAIR_ID = /^[A-Za-z0-9_-]{24}$/;
const POLL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isPairingId = (v: unknown): v is string => typeof v === "string" && PAIR_ID.test(v);
export const isPollToken = (v: unknown): v is string => typeof v === "string" && POLL_TOKEN.test(v);

function drop(p: Pairing): void {
  store.byId.delete(p.id);
  store.byToken.delete(p.pollToken);
}

/** Buang pairing kedaluwarsa (Map urut sisip, jadi yang tertua di depan). */
function sweep(now: number): void {
  for (const p of store.byId.values()) {
    if (p.expiresAt > now) break;
    drop(p);
  }
}

const live = (p: Pairing | undefined, now: number): Pairing | null => (p && p.expiresAt > now ? p : null);

export function createPairing(now = Date.now()): { id: string; pollToken: string; expiresAt: number } {
  sweep(now);
  // Penuh (mis. dibanjiri): buang yang tertua saja, jangan semuanya.
  while (store.byId.size >= MAX_PAIRINGS) drop(store.byId.values().next().value as Pairing);
  const p: Pairing = {
    id: randomBytes(18).toString("base64url"),
    pollToken: randomBytes(32).toString("base64url"),
    expiresAt: now + PAIRING_TTL_MS,
    status: "menunggu",
    approval: null,
  };
  store.byId.set(p.id, p);
  store.byToken.set(p.pollToken, p);
  return { id: p.id, pollToken: p.pollToken, expiresAt: p.expiresAt };
}

/** Untuk halaman persetujuan di HP (id dari QR). */
export function pairingById(id: string, now = Date.now()): { status: PairingStatus; expiresAt: number } | null {
  const p = live(store.byId.get(id), now);
  return p ? { status: p.status, expiresAt: p.expiresAt } : null;
}

/** Untuk komputer yang memegang pollToken. */
export function pairingByToken(
  token: string,
  now = Date.now()
): { status: PairingStatus; expiresAt: number; approval: PairingApproval | null } | null {
  const p = live(store.byToken.get(token), now);
  return p ? { status: p.status, expiresAt: p.expiresAt, approval: p.approval } : null;
}

/** Setujui atau tolak dari HP. Hanya pairing yang masih menunggu yang bisa diputuskan. */
export function decidePairing(
  id: string,
  decision: { approve: true; approval: PairingApproval } | { approve: false },
  now = Date.now()
): "OK" | "NOT_FOUND" | "DECIDED" {
  const p = live(store.byId.get(id), now);
  if (!p) return "NOT_FOUND";
  if (p.status !== "menunggu") return "DECIDED";
  if (decision.approve) {
    p.status = "disetujui";
    p.approval = decision.approval;
  } else {
    p.status = "ditolak";
  }
  return "OK";
}

/** Komputer mengambil persetujuan untuk lanjut ke Threads; sekali pakai. */
export function consumePairing(token: string, now = Date.now()): PairingApproval | "NOT_FOUND" | "NOT_APPROVED" | "USED" {
  const p = live(store.byToken.get(token), now);
  if (!p) return "NOT_FOUND";
  if (p.status === "dipakai") return "USED";
  if (p.status !== "disetujui" || !p.approval) return "NOT_APPROVED";
  p.status = "dipakai";
  return p.approval;
}

/** QR sebagai SVG ringkas: satu path, modul gelap sebaris digabung (± 2-3 KB untuk URL pendek). */
export function qrSvg(text: string): string {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  let d = "";
  for (let y = 0; y < size; y++) {
    const row = data[y];
    for (let x = 0; x < size; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Kode QR"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
