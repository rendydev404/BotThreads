"use client";

import React, { useId, useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { changePassword } from "@/lib/team-client";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError, PasswordField } from "@/components/settings/fields";
import { useT } from "@/components/i18n/lang-provider";

export const PASSWORD_MIN = 10;

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

/** Ganti password sendiri: password saat ini + password baru (minimal 10 karakter) + konfirmasi. */
export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [touched, setTouched] = useState(false);
  const formId = useId();

  const close = () => {
    if (busy) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setDone(false);
    setTouched(false);
    onClose();
  };

  const nextError = touched && next.length < PASSWORD_MIN ? t("Password minimal {n} karakter.", { n: PASSWORD_MIN }) : null;
  const confirmError = touched && confirm !== next ? t("Konfirmasi tidak sama dengan password baru.") : null;
  const sameError = touched && next.length >= PASSWORD_MIN && next === current ? t("Password baru harus berbeda dari password saat ini.") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    setError(null);
    if (!current || next.length < PASSWORD_MIN || confirm !== next || next === current) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched(false);
      setDone(true);
    } catch (err) {
      setError(t(err instanceof Error ? err.message : "Gagal mengganti password. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={close}
      busy={busy}
      title={t("Ganti password")}
      description={done ? undefined : t("Lupa password saat ini? Minta admin membuat tautan reset password untuk Anda.")}
      footer={
        done ? (
          <ModalButton variant="primary" onClick={close} data-autofocus>
            {t("Selesai")}
          </ModalButton>
        ) : (
          <>
            <ModalButton onClick={close} disabled={busy}>
              {t("Batal")}
            </ModalButton>
            <ModalButton variant="primary" type="submit" form={formId} disabled={busy || !current || !next || !confirm}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              {busy ? t("Menyimpan...") : t("Simpan password")}
            </ModalButton>
          </>
        )
      }
    >
      {done ? (
        <div role="status" className="flex items-start gap-2.5 rounded-xl bg-success-soft text-success p-3.5 text-sm font-medium">
          <CheckCircle2 className="w-[18px] h-[18px] mt-0.5 shrink-0" />
          {t("Password berhasil diganti. Perangkat lain yang masih masuk perlu masuk lagi dengan password baru.")}
        </div>
      ) : (
        <form id={formId} onSubmit={submit} noValidate className="space-y-4">
          <PasswordField
            label={t("Password saat ini")}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            disabled={busy}
            data-autofocus
            error={touched && !current ? t("Password saat ini wajib diisi.") : null}
          />
          <PasswordField
            label={t("Password baru")}
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            disabled={busy}
            maxLength={200}
            hint={t("Minimal {n} karakter.", { n: PASSWORD_MIN })}
            error={nextError ?? sameError}
          />
          <PasswordField
            label={t("Ulangi password baru")}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={busy}
            maxLength={200}
            error={confirmError}
          />
          <FormError message={error} />
        </form>
      )}
    </ModalShell>
  );
}
