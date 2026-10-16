import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.pengiriman.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.pengiriman.subtitle,
};

export default function ServiceDeliveryPage() {
  return <LegalPageLayout docId="pengiriman" />;
}
