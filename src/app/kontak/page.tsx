import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.kontak.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.kontak.subtitle,
};

export default function ContactMerchantPage() {
  return <LegalPageLayout docId="kontak" />;
}
