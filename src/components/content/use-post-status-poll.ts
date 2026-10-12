"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPostsByIds } from "@/lib/content-client";
import type { PostItemDTO } from "@/lib/content-types";

const INTERVAL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000;

const ACTIVE = new Set(["QUEUED", "PROCESSING"]);

/**
 * Polling status posting (FR-8): hanya selama masih Mengantre/Diproses, berhenti setelah 10 menit
 * atau saat tab disembunyikan (lanjut lagi ketika tab terlihat). Satu request untuk semua id.
 */
export function usePostStatusPoll(ids: string[]): Record<string, PostItemDTO> {
  const [items, setItems] = useState<Record<string, PostItemDTO>>({});
  const key = ids.join(",");
  const active = useRef(new Set<string>());

  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    active.current = new Set(list);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt > MAX_POLL_MS) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, INTERVAL_MS);
        return;
      }
      try {
        const res = await fetchPostsByIds([...active.current].slice(0, 20));
        if (stopped) return;
        setItems((prev) => {
          const next = { ...prev };
          for (const it of res.items) next[it.id] = it;
          return next;
        });
        for (const it of res.items) if (!ACTIVE.has(it.status)) active.current.delete(it.id);
        // Posting yang sudah dibatalkan tidak lagi ditemukan: berhenti memantau.
        const seen = new Set(res.items.map((i) => i.id));
        for (const id of [...active.current]) if (!seen.has(id)) active.current.delete(id);
      } catch {
        /* jaringan sesaat: coba lagi di putaran berikutnya */
      }
      if (!stopped && active.current.size > 0) timer = setTimeout(tick, INTERVAL_MS);
    };

    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  return items;
}
