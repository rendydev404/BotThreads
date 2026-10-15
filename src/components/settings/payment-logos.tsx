import React from "react";
import type { PaymentMethodId } from "@/lib/billing-types";
import { cn } from "@/lib/utils";

/**
 * Logo resmi metode bayar (SVG statis di public/payments, 3-11 KB, di-cache browser).
 * Sumber: Wikimedia Commons (QRIS, GoPay, bank) dan panduan merek ShopeePay. Logo tidak boleh
 * diubah bentuk/warnanya, jadi selalu di atas petak putih dengan object-contain.
 */
const FILES: Record<PaymentMethodId, string> = {
  qris: "/payments/qris.svg",
  gopay: "/payments/gopay.svg",
  shopeepay: "/payments/shopeepay.svg",
  bca_va: "/payments/bca.svg",
  bni_va: "/payments/bni.svg",
  bri_va: "/payments/bri.svg",
  mandiri_bill: "/payments/mandiri.svg",
  permata_va: "/payments/permata.svg",
  cimb_va: "/payments/cimb.svg",
};

export function PaymentLogo({ id, className }: { id: PaymentMethodId; className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg bg-white border border-black/5 shrink-0 px-1.5 py-1", className ?? "w-16 h-10")}>
      {/* SVG statis kecil: <img> biasa, tanpa optimasi next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={FILES[id]} alt="" aria-hidden="true" decoding="async" draggable={false} className="max-w-full max-h-full object-contain" />
    </span>
  );
}
