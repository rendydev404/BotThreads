import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.pengembalian.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.pengembalian.subtitle,
};

export default function RefundPolicyPage() {
  return <LegalPageLayout docId="pengembalian" />;
}
