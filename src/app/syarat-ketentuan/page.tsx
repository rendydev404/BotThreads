import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.ketentuan.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.ketentuan.subtitle,
  alternates: { canonical: LEGAL_DOCUMENTS.ketentuan.href },
};

export default function TermsOfServicePage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(LEGAL_DOCUMENTS.ketentuan.title, LEGAL_DOCUMENTS.ketentuan.href)} />
      <LegalPageLayout docId="ketentuan" />
    </>
  );
}
