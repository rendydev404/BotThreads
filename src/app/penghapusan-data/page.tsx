import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCircle2 } from "lucide-react";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";
import { LEGAL_DOCUMENTS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS.penghapusan.title} | BotThreads`,
  description: LEGAL_DOCUMENTS.penghapusan.subtitle,
};

type Props = { searchParams: Promise<{ kode?: string }> };

/**
 * Status permintaan dari callback Data Deletion Meta (/api/threads/data-deletion membalas tautan ke sini
 * dengan `?kode=`). Penghapusan dijalankan saat callback diterima, jadi statusnya selalu selesai.
 */
async function DeletionStatus({ searchParams }: Props) {
  const kode = (await searchParams).kode;
  if (!kode || !/^[0-9A-F]{16}$/.test(kode)) return null;
  return (
    <div role="status" className="mx-auto max-w-3xl px-4 pt-6">
      <div className="flex items-start gap-3 rounded-xl border border-line bg-success-soft p-4 text-sm text-fg">
        <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-success" />
        <div className="space-y-1">
          <p className="font-semibold">Permintaan penghapusan data diterima dan sudah diproses.</p>
          <p>Akun Threads yang terhubung beserta token dan pengaturannya sudah dihapus dari BotThreads.</p>
          <p className="text-muted">Your data deletion request has been received and processed. The connected Threads account, its token and settings have been deleted.</p>
          <p>
            Kode konfirmasi / Confirmation code: <span className="font-mono font-semibold">{kode}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DataDeletionPage({ searchParams }: Props) {
  return (
    <>
      <Suspense fallback={null}>
        <DeletionStatus searchParams={searchParams} />
      </Suspense>
      <LegalPageLayout docId="penghapusan" />
    </>
  );
}
