import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.ketentuan.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.ketentuan.subtitle,
};

export default function TermsOfServicePage() {
  return <LegalPageLayout docId="ketentuan" />;
}
