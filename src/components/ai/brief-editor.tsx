"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { useLang } from "@/components/i18n/lang-provider";

/**
 * Tombol "Perbesar" + editor layar penuh untuk teks panjang (Peran & tema akun / prompt peran). Mengedit salinan;
 * "Pakai" mengembalikan teksnya ke form asal, "Batal" membuang perubahan.
 */
export function BriefExpandButton({
  value,
  onChange,
  maxLength,
  title = "Peran & tema akun (Profil AI)",
  disabled,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t, locale } = useLang();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Kursor di akhir teks saat editor dibuka, supaya bisa langsung melanjutkan tulisan.
  useEffect(() => {
    if (!open) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const over = draft.length > maxLength * 0.9;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className={cn(
          "h-7 px-2.5 rounded-full text-xs font-semibold text-muted hover:text-accent hover:bg-subtle inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          className
        )}
      >
        <Maximize2 className="w-3.5 h-3.5" />
        {t("Perbesar")}
      </button>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        size="full"
        title={t(title)}
        description={t("Editor lebar untuk menulis atau membaca prompt peran yang panjang. Baris baru tetap tersimpan.")}
        footer={
          <>
            <span className={cn("sm:mr-auto text-xs tabular-nums", over ? "text-warning font-semibold" : "text-muted")}>
              {t("{words} kata · {used}/{max} karakter", {
                words: words.toLocaleString(locale),
                used: draft.length.toLocaleString(locale),
                max: maxLength.toLocaleString(locale),
              })}
            </span>
            <ModalButton onClick={() => setOpen(false)}>{t("Batal")}</ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              {t("Pakai teks ini")}
            </ModalButton>
          </>
        }
      >
        <textarea
          ref={areaRef}
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="w-full h-[calc(88dvh-13rem)] min-h-64 resize-none rounded-xl border border-line-strong bg-surface px-4 py-3.5 text-[15px] leading-relaxed text-fg placeholder-faint outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
          placeholder={t("Tulis peran akun: siapa akun ini, bahas apa, untuk siapa, gaya bahasanya, aturan dan larangannya.")}
        />
      </ModalShell>
    </>
  );
}
