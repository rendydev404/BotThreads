import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminHome } from "@/components/admin/admin-home";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Ringkasan · Konsol Admin BotThreads" };

export default function AdminIndexPage() {
  // AdminHome membaca ?tab= (tautan lama), jadi perlu batas Suspense agar halaman bisa di-prerender.
  return (
    <Suspense fallback={null}>
      <AdminHome />
    </Suspense>
  );
}
