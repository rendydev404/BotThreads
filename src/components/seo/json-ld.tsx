import { jsonLdString } from "@/lib/site";

/** Data terstruktur schema.org yang ikut dirender di HTML server (mesin AI tidak menjalankan JavaScript). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
