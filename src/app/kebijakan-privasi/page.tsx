import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.privasi.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.privasi.subtitle,
  alternates: { canonical: LEGAL_DOCUMENTS.privasi.href },
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(LEGAL_DOCUMENTS.privasi.title, LEGAL_DOCUMENTS.privasi.href)} />
      <LegalPageLayout docId="privasi" />
    </>
  );
}
