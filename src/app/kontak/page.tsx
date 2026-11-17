import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.kontak.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.kontak.subtitle,
  alternates: { canonical: LEGAL_DOCUMENTS.kontak.href },
};

export default function ContactMerchantPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(LEGAL_DOCUMENTS.kontak.title, LEGAL_DOCUMENTS.kontak.href)} />
      <LegalPageLayout docId="kontak" />
    </>
  );
}
