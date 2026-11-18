import { NextResponse, connection } from "next/server";
import { publicPixelId } from "@/lib/meta-pixel";

/**
 * Pixel ID Meta untuk peramban (publik; Pixel ID memang tampil di kode halaman mana pun yang memasangnya).
 * Di-cache 5 menit di peramban/CDN supaya tiap kunjungan tidak menambah beban server.
 */
export async function GET() {
  // Selalu dibaca saat permintaan (bukan saat build), supaya Pixel ID yang diubah admin langsung berlaku.
  await connection();
  try {
    const pixelId = await publicPixelId();
    return NextResponse.json({ pixelId }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ pixelId: null }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
}
