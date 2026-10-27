"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Clock, Copy } from "lucide-react";
import { formatWibFull } from "@/lib/scheduling";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Banner } from "@/components/autopilot/shared";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";

export interface OneTimeLink {
  kind: "invite" | "reset";
  /** Penerima tautan (email undangan atau nama anggota). */
  who: string;
  /** Tautan lengkap (`location.origin + path`). Hanya hidup di state dialog ini; tidak pernah dicatat. */
  url: string;
  /** ISO UTC. */
  expiresAt: string;
  /** Lama berlaku untuk kalimat ("3 hari", "1 jam"), dihitung pemanggil dari `expiresAt`. */
  ttl: string;
}

const COPY: Record<OneTimeLink["kind"], { title: string; label: string; send: (who: string) => string }> = {
  invite: {
    title: "Tautan undangan",
    label: "Tautan undangan",
    send: (who) => tr("Salin lalu kirim sendiri ke {who}. Undangan lama untuk email ini otomatis tidak berlaku.", { who }),
  },
  reset: {
    title: "Tautan reset password",
    label: "Tautan reset password",
    send: (who) => tr("Salin lalu kirim sendiri ke {who} lewat saluran yang aman.", { who }),
  },
};

const COPIED_MS = 2500;

function LinkDialog({ link, onClose }: { link: OneTimeLink; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [everCopied, setEverCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [warned, setWarned] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = COPY[link.kind];

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setEverCopied(true);
      setManual(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard API tidak tersedia (mis. bukan HTTPS): pilih teksnya supaya bisa disalin manual.
      areaRef.current?.focus();
      areaRef.current?.select();
      setManual(true);
    }
  };

  // Tautan tidak bisa ditampilkan lagi: penutupan pertama sebelum disalin hanya memberi peringatan.
  const close = () => {
    if (!everCopied && !warned) {
      setWarned(true);
      return;
    }
    onClose();
  };

  return (
    <ModalShell
      open
      onClose={close}
      title={t(copy.title)}
      description={t("Untuk {who}", { who: link.who })}
      footer={
        <>
          <ModalButton onClick={close}>{everCopied ? t("Selesai") : t("Tutup")}</ModalButton>
          <ModalButton variant="primary" onClick={copyLink} data-autofocus>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? t("Tersalin") : t("Salin tautan")}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-3">
        <Banner tone="warning">
          <p className="font-semibold">{t("Tautan ini hanya ditampilkan sekali.")}</p>
          <p className="mt-0.5">{copy.send(link.who)} {t("Setelah jendela ini ditutup, tautan tidak bisa dilihat lagi.")}</p>
        </Banner>

        <textarea
          ref={areaRef}
          readOnly
          rows={3}
          value={link.url}
          aria-label={t(copy.label)}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className="w-full px-3.5 py-2.5 rounded-xl bg-subtle border border-transparent text-[13px] leading-relaxed text-fg font-mono break-all resize-none outline-none focus:bg-surface focus:border-accent transition-colors"
        />

        <p className="flex items-start gap-1.5 text-[13px] text-muted">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {t("Berlaku sampai")} <span className="font-semibold text-fg">{formatWibFull(new Date(link.expiresAt))}</span>{" "}
            {t("({ttl} dari sekarang) dan hanya bisa dipakai sekali.", { ttl: link.ttl })}
          </span>
        </p>

        <p role="status" aria-live="polite" className="sr-only">
          {copied ? t("Tautan tersalin.") : ""}
        </p>
        {manual && <Banner tone="info">{t("Penyalinan otomatis tidak tersedia. Teks tautan sudah dipilih; salin secara manual.")}</Banner>}
        {warned && !everCopied && (
          <Banner tone="danger">{t("Tautan belum disalin. Tekan Tutup sekali lagi bila memang ingin menutup tanpa menyalin.")}</Banner>
        )}
      </div>
    </ModalShell>
  );
}

/** Dialog tautan sekali tampil (undangan atau reset password) dengan tombol salin. `link = null` berarti tertutup. */
export function OneTimeLinkModal({ link, onClose }: { link: OneTimeLink | null; onClose: () => void }) {
  if (!link) return null;
  // Kunci dari waktu kedaluwarsa (unik per tautan), bukan dari tautannya, supaya token tidak menjadi key.
  return <LinkDialog key={link.expiresAt} link={link} onClose={onClose} />;
}
