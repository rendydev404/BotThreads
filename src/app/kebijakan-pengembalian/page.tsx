import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.pengembalian.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.pengembalian.subtitle,
  alternates: { canonical: LEGAL_DOCUMENTS.pengembalian.href },
};

export default function RefundPolicyPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(LEGAL_DOCUMENTS.pengembalian.title, LEGAL_DOCUMENTS.pengembalian.href)} />
      <LegalPageLayout docId="pengembalian" />
    </>
  );
}
