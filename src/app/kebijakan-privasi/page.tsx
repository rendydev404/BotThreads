import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.privasi.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.privasi.subtitle,
};

export default function PrivacyPolicyPage() {
  return <LegalPageLayout docId="privasi" />;
}
