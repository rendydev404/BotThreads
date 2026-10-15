"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { fetchMe, type MeResponse, type Role } from "@/lib/team-client";

/**
 * Profil pengguna yang sedang masuk (nama, peran, workspace). Satu penyimpanan tingkat modul dipakai
 * bersama header, shell, dan halaman: cache 60 detik, permintaan serentak digabung menjadi satu, dan
 * semua pemakai ikut diperbarui saat data berubah.
 */
const TTL_MS = 60_000;
/** Jeda minimal sebelum mencoba lagi setelah gagal, supaya banyak komponen tidak memicu rentetan fetch. */
const RETRY_GAP_MS = 5_000;

interface Snapshot {
  me: MeResponse | null;
  error: string | null;
}

const EMPTY: Snapshot = { me: null, error: null };
let snapshot: Snapshot = EMPTY;
let fetchedAt = 0;
let attemptedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(force = false): Promise<void> {
  const now = Date.now();
  if (!force) {
    if (snapshot.me && now - fetchedAt < TTL_MS) return Promise.resolve();
    if (!snapshot.me && snapshot.error && now - attemptedAt < RETRY_GAP_MS) return Promise.resolve();
  }
  attemptedAt = now;
  inflight ??= fetchMe()
    .then(
      (me) => {
        fetchedAt = Date.now();
        snapshot = { me, error: null };
      },
      (err: unknown) => {
        snapshot = { me: snapshot.me, error: err instanceof Error ? err.message : "Gagal memuat profil." };
      }
    )
    .finally(() => {
      inflight = null;
      listeners.forEach((notify) => notify());
    });
  return inflight;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

/** Peran minimal setingkat `min`? Peran yang belum diketahui dianggap tidak cukup. */
export const roleAtLeast = (role: Role | null | undefined, min: Role): boolean => !!role && RANK[role] >= RANK[min];

export function useMe() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void load();
  }, []);

  const reload = useCallback(() => load(true), []);
  const role = snap.me?.role ?? null;

  return {
    me: snap.me,
    loading: !snap.me && !snap.error,
    error: snap.error,
    role,
    /** Boleh mengubah data (Editor ke atas). Pengamat hanya melihat. */
    canEdit: roleAtLeast(role, "EDITOR"),
    /** Boleh mengelola tim, audit, kesehatan, dan pengaturan workspace. */
    isAdmin: roleAtLeast(role, "ADMIN"),
    isOwner: role === "OWNER",
    reload,
  };
}
