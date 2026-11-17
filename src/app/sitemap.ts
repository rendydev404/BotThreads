import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE_URL } from "@/lib/site";

/**
 * Halaman publik saja. Tanpa lastModified: tanggal yang selalu "hari ini" adalah sinyal palsu dan membuat Google
 * mengabaikan lastmod situs ini; tanpa tanggal, Google menilai sendiri dari isi halaman.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
