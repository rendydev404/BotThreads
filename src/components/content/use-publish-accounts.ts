"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPublishAccounts } from "@/lib/content-client";
import type { AccountsResponse } from "@/lib/content-types";

/**
 * Akun yang bisa diposting + status saklar fitur. Cache modul 30 detik dan permintaan serentak
 * digabung, sehingga banyak kartu draf di chat tidak memicu banyak fetch.
 */
const TTL_MS = 30_000;
let cached: { at: number; data: AccountsResponse } | null = null;
let inflight: Promise<AccountsResponse> | null = null;

function load(force = false): Promise<AccountsResponse> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.data);
  inflight ??= fetchPublishAccounts()
    .then((data) => {
      cached = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

type State =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: AccountsResponse; error: null }
  | { status: "error"; data: null; error: string };

export function usePublishAccounts() {
  const [state, setState] = useState<State>(
    cached ? { status: "ready", data: cached.data, error: null } : { status: "loading", data: null, error: null }
  );

  const run = useCallback((force: boolean) => {
    load(force).then(
      (data) => setState({ status: "ready", data, error: null }),
      (err: unknown) =>
        setState({
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : "Gagal memuat akun.",
        })
    );
  }, []);

  useEffect(() => {
    run(false);
  }, [run]);

  const reload = useCallback(() => {
    setState({ status: "loading", data: null, error: null });
    run(true);
  }, [run]);

  return {
    loading: state.status === "loading",
    error: state.error,
    accounts: state.data?.accounts ?? [],
    publishEnabled: state.data?.publishEnabled ?? false,
    limits: state.data?.limits ?? null,
    reload,
  };
}
