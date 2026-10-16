import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.penghapusan.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.penghapusan.subtitle,
};

export default function DataDeletionPage() {
  return <LegalPageLayout docId="penghapusan" />;
}
