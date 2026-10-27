"use client";

import React, { useId, useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";

/** Kelas dasar input teks (satu baris) supaya semua form memakai tampilan yang sama. */
export const INPUT_CLS =
  "w-full h-11 px-3.5 rounded-xl bg-subtle border border-transparent text-sm text-fg placeholder:text-faint outline-none transition-colors focus:bg-surface focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed";

const LABEL_CLS = "text-[13px] font-semibold text-fg";

function FieldFrame({
  id,
  label,
  count,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  /** "12/80" di kanan label. */
  count?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={LABEL_CLS}>
          {label}
        </label>
        {count && <span className="text-xs text-faint tabular-nums shrink-0">{count}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-1.5 text-xs text-muted leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
  error?: string | null;
  /** Tampilkan penghitung karakter (butuh `maxLength`). */
  showCount?: boolean;
};

export function TextField({ label, value, onChange, hint, error, showCount, maxLength, className, ...props }: TextFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} count={showCount && maxLength ? `${value.length}/${maxLength}` : undefined}>
      <input
        type="text"
        {...props}
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cn(INPUT_CLS, error && "border-danger focus:border-danger", className)}
      />
    </FieldFrame>
  );
}

type TextAreaFieldProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "value" | "onChange"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
  error?: string | null;
};

export function TextAreaField({ label, value, onChange, hint, error, maxLength, rows = 4, className, ...props }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} count={maxLength ? `${value.length}/${maxLength}` : undefined}>
      <textarea
        {...props}
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cn(INPUT_CLS, "h-auto py-2.5 leading-relaxed resize-y min-h-24", error && "border-danger focus:border-danger", className)}
      />
    </FieldFrame>
  );
}

type PasswordFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
  error?: string | null;
};

/** Input password dengan tombol tampilkan/sembunyikan. */
export function PasswordField({ label, value, onChange, hint, error, className, ...props }: PasswordFieldProps) {
  const t = useT();
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          {...props}
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={cn(INPUT_CLS, "pr-12", error && "border-danger focus:border-danger", className)}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? t("Sembunyikan {label}", { label: label.toLowerCase() }) : t("Tampilkan {label}", { label: label.toLowerCase() })}
          aria-pressed={show}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg text-muted hover:text-fg flex items-center justify-center transition-colors cursor-pointer"
        >
          {show ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
        </button>
      </div>
    </FieldFrame>
  );
}

/** Label untuk kontrol kustom (dropdown, segmen) yang tidak punya elemen <input>. */
export function ControlLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <p className={LABEL_CLS}>{children}</p>
      {hint && <p className="mt-0.5 text-xs text-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

/** Pesan galat form (validasi server atau jaringan). */
export function FormError({ message, details, className }: { message: string | null | undefined; details?: string[]; className?: string }) {
  const t = useT();
  if (!message) return null;
  return (
    <div role="alert" className={cn("flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium", className)}>
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0 break-words">
        <p>{t(message)}</p>
        {details && details.length > 0 && (
          <ul className="mt-1 list-disc pl-4 font-normal">
            {details.slice(0, 6).map((d, i) => (
              <li key={i}>{t(d)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
