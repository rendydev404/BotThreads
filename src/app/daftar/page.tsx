import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { RegisterForm } from "@/components/auth/register-form";
import { signupOpen } from "@/lib/team-service";

export const metadata: Metadata = {
  title: "Daftar | BotThreads",
  description: "Buat akun dan workspace untuk mengelola konten Threads brand Anda dengan AI.",
};

/** Saklar pendaftaran dibaca dari env saat permintaan datang, bukan saat image dibangun. */
async function Register() {
  await connection();
  return <RegisterForm open={await signupOpen()} />;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <Register />
    </Suspense>
  );
}
