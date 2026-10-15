import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getGoogleConfig } from "@/lib/google-oauth";
import { signupOpen } from "@/lib/team-service";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Masuk | BotThreads",
  robots: { index: false, follow: false },
};

/** Saklar Google dibaca dari konfigurasi integrasi/env saat permintaan datang. */
async function LoginGate() {
  await connection();
  const [gcfg, canSignup] = await Promise.all([getGoogleConfig(), signupOpen()]);
  return <LoginForm google={gcfg.enabled} signup={canSignup} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginGate />
    </Suspense>
  );
}
