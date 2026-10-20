/**
 * Membuat soundtrack film demo di halaman perkenalan: public/film/autopilot.mp3.
 * Semua suara disintesis di sini (tanpa sampel dari luar), jadi tidak ada urusan lisensi musik.
 * Waktu efek suara mengikuti frame adegan di src/components/landing/film/autopilot-film.tsx
 * (30 fps, total 690 frame); ubah keduanya bersamaan.
 *
 *   node scripts/gen-film-audio.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Mp3Encoder } from "@breezystack/lamejs";

const SR = 44100;
const FPS = 30;
const FRAMES = 690;
const DUR = FRAMES / FPS;
const N = Math.ceil(DUR * SR);
const out = new Float32Array(N);
const f2t = (frame) => frame / FPS;

// Acak yang bisa diulang, supaya hasil generate selalu sama.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** Tambahkan suara mulai detik `t`, selama `len` detik; fn(waktuLokal, indeks) mengembalikan sampel. */
function add(t, len, fn) {
  const s0 = Math.max(0, Math.floor(t * SR));
  const s1 = Math.min(N, Math.floor((t + len) * SR));
  for (let i = s0; i < s1; i++) out[i] += fn((i - s0) / SR, i);
}
const TAU = Math.PI * 2;
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
const tri = (ph) => 1 - 4 * Math.abs(ph - Math.floor(ph + 0.5));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const lp = (cut) => {
  // Low-pass satu kutub; cut boleh berubah per sampel.
  let y = 0;
  return (x, c = cut) => (y += (1 - Math.exp((-TAU * c) / SR)) * (x - y));
};

/* ------------------------------------------------------------------ musik */
const BEAT = 0.5; // 120 BPM
const CHORDS = [
  { root: 110, pad: [220, 261.63, 329.63] }, // Am
  { root: 87.31, pad: [174.61, 220, 261.63] }, // F
  { root: 130.81, pad: [261.63, 329.63, 392] }, // C
  { root: 98, pad: [196, 246.94, 293.66] }, // G
];
const chordAt = (t) => CHORDS[Math.floor(t / (4 * BEAT)) % CHORDS.length];
const OUTRO = f2t(600);

// Pad: saw ganda yang sedikit sumbang, disaring pelan supaya terasa "ruang".
for (let c = 0; c * 2 < DUR; c++) {
  const t0 = c * 2;
  const chord = CHORDS[c % 4];
  const len = Math.min(2.6, DUR - t0);
  for (const f of chord.pad) {
    for (const det of [0.996, 1.004]) {
      const filt = lp(900);
      add(t0, len, (t) => {
        const a = Math.min(1, t / 0.35) * Math.min(1, (len - t) / 0.5);
        const cut = 700 + 500 * Math.sin(TAU * 0.15 * (t0 + t));
        return filt(saw(f * det * t), cut) * a * 0.045;
      });
    }
  }
}

// Bass berdenyut per seperdelapan ketukan, mulai saat adegan pertama selesai.
{
  const filt = lp(380);
  for (let t0 = f2t(75); t0 < OUTRO; t0 += BEAT / 2) {
    const f = chordAt(t0).root;
    add(t0, BEAT / 2, (t) => filt(saw(f * t) * 0.7 + Math.sin(TAU * f * t) * 0.6) * env(t, 0.005, 0.12) * 0.32);
  }
}

// Arpeggio seperenam belas ketukan + gema.
{
  const arpStart = f2t(60);
  let n = 0;
  for (let t0 = arpStart; t0 < OUTRO + 1.5; t0 += BEAT / 4, n++) {
    const tones = chordAt(t0).pad;
    const f = tones[[0, 1, 2, 1][n % 4]] * (n % 8 < 4 ? 2 : 4);
    const fade = t0 > OUTRO ? Math.max(0, 1 - (t0 - OUTRO) / 1.5) : 1;
    for (const [delay, g] of [
      [0, 1],
      [0.375, 0.35],
      [0.75, 0.12],
    ]) {
      add(t0 + delay, 0.2, (t) => (tri(f * t) * 0.6 + Math.sin(TAU * f * t) * 0.4) * env(t, 0.003, 0.06) * 0.05 * g * fade);
    }
  }
}

// Drum: kick tiap ketukan, hi-hat di sela ketukan.
function kick(t0, gain = 0.5, len = 0.35) {
  let ph = 0;
  add(t0, len, (t) => {
    ph += (45 + 90 * Math.exp(-t * 30)) / SR;
    return Math.sin(TAU * ph) * env(t, 0.002, len / 3) * gain;
  });
}
for (let t0 = f2t(75); t0 < OUTRO - 0.1; t0 += BEAT) kick(t0, 0.42);
for (let t0 = f2t(180) + BEAT / 2; t0 < OUTRO - 0.1; t0 += BEAT) {
  let prev = 0;
  add(t0, 0.06, (t) => {
    const x = rand();
    const hp = x - prev;
    prev = x;
    return hp * env(t, 0.001, 0.018) * 0.06;
  });
}

/* ------------------------------------------------------------------ efek suara */
function whoosh(t0, len = 0.5, gain = 0.22, up = false) {
  const filt = lp(400);
  add(t0, len, (t) => {
    const p = t / len;
    const cut = up ? 300 + 5000 * p * p : 300 + 4200 * Math.sin(Math.PI * p);
    return filt(rand(), cut) * Math.sin(Math.PI * p) ** 1.5 * gain;
  });
}
function bell(t0, f, gain = 0.12, decay = 0.35) {
  add(t0, decay * 5, (t) => (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.01 * t) + 0.12 * Math.sin(TAU * f * 3.02 * t)) * env(t, 0.003, decay) * gain);
}
function blip(t0, f, gain = 0.1) {
  add(t0, 0.15, (t) => Math.sin(TAU * f * t) * env(t, 0.002, 0.03) * gain);
}
function click(t0, gain) {
  let prev = 0;
  add(t0, 0.03, (t) => {
    const x = rand();
    const hp = x - prev;
    prev = x;
    return (hp * 0.7 + Math.sin(TAU * 2800 * t) * 0.3) * env(t, 0.0005, 0.006) * gain;
  });
}

// Riser pembuka menuju adegan tren, lalu dentuman.
{
  const filt = lp(200);
  const len = f2t(75);
  add(0, len, (t) => filt(rand(), 150 + 3000 * (t / len) ** 2) * (t / len) ** 2 * 0.16);
}
kick(f2t(75), 0.6, 0.6);
// Baris "boot" di adegan pembuka.
[36, 45, 54, 63].forEach((fr, i) => blip(f2t(fr), [880, 988, 1108, 1318][i], 0.09));
// Transisi antaradegan.
for (const s of [75, 180, 285, 375, 480, 600]) whoosh(f2t(s) - 0.12, 0.5, 0.2);
// Radar: ping tiap sinyal ditemukan, lalu ide teratas terpilih.
[14, 26, 38, 50].forEach((d) => bell(f2t(75 + d), 1480, 0.07, 0.18));
bell(f2t(75 + 96), 1046.5, 0.08, 0.25);
bell(f2t(75 + 99), 1568, 0.07, 0.3);
// Mengetik.
for (let fr = 198; fr < 278; fr += 1.6 + Math.abs(rand()) * 1.4) click(f2t(fr), 0.12 + Math.abs(rand()) * 0.06);
// Empat pemeriksaan lolos, jarum skor naik, lalu bunyi "lolos".
[303, 314, 325, 336].forEach((fr, i) => bell(f2t(fr), [659, 784, 880, 1046.5][i], 0.08, 0.12));
{
  let ph = 0;
  const t0 = f2t(337);
  const len = f2t(373) - t0;
  add(t0, len, (t) => {
    ph += (300 + 600 * (t / len) ** 0.6) / SR;
    return Math.sin(TAU * ph) * Math.sin(Math.PI * (t / len)) * 0.035;
  });
}
[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f2t(373) + i * 0.06, f, 0.09, 0.5));
// Slot jadwal jatuh ke jam ramai.
for (const fr of [427, 439, 451]) {
  let ph = 0;
  add(f2t(fr), 0.25, (t) => {
    ph += (1300 - 700 * Math.min(1, t / 0.08)) / SR;
    return Math.sin(TAU * ph) * env(t, 0.002, 0.07) * 0.1;
  });
}
// Terbit: desis naik + dentum.
whoosh(f2t(476), 0.35, 0.18, true);
kick(f2t(488), 0.45, 0.4);
// Hitungan views berdetak pelan.
for (let fr = 504; fr < 590; fr += 3) blip(f2t(fr), 2400, 0.018);
// Notifikasi viral.
bell(f2t(562), 987.77, 0.12, 0.25);
bell(f2t(568), 1318.5, 0.12, 0.4);
// Penutup: dentuman besar + gemerlap.
kick(f2t(605), 0.75, 1.1);
{
  const filt = lp(2500);
  add(f2t(605), 1.4, (t) => filt(rand()) * env(t, 0.002, 0.35) * 0.12);
}
[880, 1108.73, 1318.5, 1760].forEach((f, i) => bell(f2t(608) + i * 0.09, f, 0.06, 0.7));

/* ------------------------------------------------------------------ mastering & encode */
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.05) * Math.min(1, (DUR - t) / 1.2);
  out[i] = Math.tanh(out[i] * 1.1) * fade;
  peak = Math.max(peak, Math.abs(out[i]));
}
const gain = 0.89 / peak;
const pcm = new Int16Array(N);
for (let i = 0; i < N; i++) pcm[i] = Math.round(out[i] * gain * 32767);

const enc = new Mp3Encoder(1, SR, 96);
const chunks = [];
for (let i = 0; i < N; i += 1152) chunks.push(enc.encodeBuffer(pcm.subarray(i, i + 1152)));
chunks.push(enc.flush());
const mp3 = Buffer.concat(chunks.map((c) => Buffer.from(c)));
mkdirSync("public/film", { recursive: true });
writeFileSync("public/film/autopilot.mp3", mp3);
console.log(`public/film/autopilot.mp3: ${(mp3.length / 1024).toFixed(0)} KB, ${DUR.toFixed(1)} detik`);
