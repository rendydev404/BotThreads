import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.pengiriman.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.pengiriman.subtitle,
  alternates: { canonical: LEGAL_DOCUMENTS.pengiriman.href },
};

export default function ServiceDeliveryPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(LEGAL_DOCUMENTS.pengiriman.title, LEGAL_DOCUMENTS.pengiriman.href)} />
      <LegalPageLayout docId="pengiriman" />
    </>
  );
}
