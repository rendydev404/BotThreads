import { agg, db, excludedIdList, must, onlyVisible, rpc, sqlTs, toDate } from "@/lib/supabase";
import { scopeKey } from "@/lib/tenant-scope";
import { bestHoursForAccounts } from "@/lib/best-hours";
import { loadPostStats } from "@/lib/chat-insights";

/**
 * Konteks data live untuk asisten AI. Semua agregasi dikerjakan di database;
 * hasilnya di-cache 60 detik supaya chat beruntun tidak membebani DB.
 */

const TTL_MS = 60_000;

const MEDIA_LABEL: Record<string, string> = {
  TEXT_POST: "Teks",
  TEXT: "Teks",
  IMAGE: "Foto",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REPOST_FACADE: "Repost",
};

const fmt = (n: number) => n.toLocaleString("id-ID");
const clip = (s: string, n: number) =>
  s.replace(/\s+/g, " ").trim().slice(0, n) + (s.length > n ? "…" : "");

export interface FleetContext {
  text: string;
  totals: {
    accounts: number;
    posts: number;
    views: number;
    interactions: number;
    er: string;
    followers: number;
  };
  byPosts: Array<{ username: string; posts: number; followers: number }>;
  byViews: Array<{ username: string; views: number; likes: number; replies: number; followers: number }>;
  byFollowers: Array<{ username: string; displayName: string; followers: number }>;
  topPosts: Array<{ username: string; text: string; views: number }>;
  usernames: string[];
}

// Per lingkup tenant: ringkasan armada satu workspace tidak boleh tersaji ke workspace lain.
const cache = new Map<string, { at: number; value: FleetContext }>();

async function loadFleet(): Promise<FleetContext> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  type PostRow = {
    text: string;
    views: number;
    likes: number;
    replies: number;
    mediaType: string;
    postedAt: string;
    ThreadsAccount: { username: string | null } | null;
  };
  const postSel = "text, views, likes, replies, mediaType, postedAt, ThreadsAccount(username)";
  const hidden = await excludedIdList();
  const posts = () => {
    const q = db().from("ThreadsPostStat").select(postSel);
    return hidden ? q.not("threadsAccountId", "in", hidden) : q;
  };

  const [accountRows, postCounts, perAccountRows, topPostRows, flopPostRows, mediaRows, last7Rows, followerRows] =
    await Promise.all([
      must<{ id: string; username: string | null; displayName: string }[]>(
        db().from("ThreadsAccount").select("id, username, displayName")
      ).then(onlyVisible),
      agg.postsByAccount(),
      agg.dailyByAccount(),
      must<PostRow[]>(posts().order("views", { ascending: false }).limit(30)),
      must<PostRow[]>(
        posts()
          .gt("views", 0)
          .lt("postedAt", sqlTs(new Date(Date.now() - 3 * 86_400_000)))
          .order("views", { ascending: true })
          .limit(5)
      ),
      agg.postsByMedia(),
      agg.dailyByDate({ from: since }),
      agg.latestFollowers(),
    ]);

  // Bentuk hasil disamakan dengan query Prisma sebelumnya
  const countOf = new Map(postCounts.map((c) => [c.threadsAccountId, c.posts]));
  const accounts = accountRows.map((a) => ({ ...a, _count: { postStats: countOf.get(a.id) ?? 0 } }));
  const total = {
    _sum: perAccountRows.reduce(
      (s, r) => ({
        views: s.views + r.views,
        likes: s.likes + r.likes,
        replies: s.replies + r.replies,
        reposts: s.reposts + r.reposts,
      }),
      { views: 0, likes: 0, replies: 0, reposts: 0 }
    ),
  };
  const perAccount = perAccountRows.map((r) => ({
    threadsAccountId: r.threadsAccountId,
    _sum: { views: r.views, likes: r.likes, replies: r.replies },
  }));
  const asPost = ({ ThreadsAccount, ...p }: PostRow) => ({
    ...p,
    postedAt: toDate(p.postedAt),
    threadsAccount: ThreadsAccount,
  });
  const topPosts = topPostRows.map(asPost);
  const flopPosts = flopPostRows.map(asPost);
  const byMedia = mediaRows.map((m) => ({
    mediaType: m.mediaType,
    _count: { _all: m.posts },
    _avg: { views: m.avg_views },
    _sum: { likes: m.likes, replies: m.replies, views: m.views },
  }));
  const last7 = last7Rows.map((d) => ({
    date: toDate(d.date),
    _sum: { views: d.views, likes: d.likes, replies: d.replies },
  }));

  const latestFollowersMap = new Map<string, number>();
  for (const r of followerRows) {
    if (r.followers !== null && !latestFollowersMap.has(r.threadsAccountId)) {
      latestFollowersMap.set(r.threadsAccountId, r.followers);
    }
  }

  let totalFollowers = 0;
  for (const f of latestFollowersMap.values()) {
    totalFollowers += f;
  }

  const nameOf = new Map(accounts.map((a) => [a.id, a.username || a.displayName]));
  const views = total._sum.views ?? 0;
  const interactions =
    (total._sum.likes ?? 0) + (total._sum.replies ?? 0) + (total._sum.reposts ?? 0);
  const er = views > 0 ? ((interactions / views) * 100).toFixed(2) : "0";
  const postsTotal = accounts.reduce((s, a) => s + a._count.postStats, 0);

  const byFollowers = accounts
    .map((a) => ({
      username: a.username || a.displayName,
      displayName: a.displayName,
      followers: latestFollowersMap.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.followers - a.followers);

  const byPosts = accounts
    .map((a) => ({
      username: a.username || a.displayName,
      posts: a._count.postStats,
      followers: latestFollowersMap.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.posts - a.posts);

  const byViews = perAccount
    .map((d) => ({
      username: nameOf.get(d.threadsAccountId) || "unknown",
      views: d._sum.views ?? 0,
      likes: d._sum.likes ?? 0,
      replies: d._sum.replies ?? 0,
      followers: latestFollowersMap.get(d.threadsAccountId) ?? 0,
    }))
    .sort((a, b) => b.views - a.views);

  const top = topPosts.slice(0, 10).map((p) => ({
    username: p.threadsAccount?.username || "unknown",
    text: p.text || "",
    views: p.views,
    likes: p.likes,
    replies: p.replies,
    media: MEDIA_LABEL[p.mediaType] || p.mediaType,
  }));

  const mediaText = byMedia
    .map((m) => {
      const inter = (m._sum.likes ?? 0) + (m._sum.replies ?? 0);
      const mViews = m._sum.views ?? 0;
      return `- ${MEDIA_LABEL[m.mediaType] || m.mediaType}: ${fmt(m._count._all)} post, rata-rata ${fmt(Math.round(m._avg.views ?? 0))} views/post, ER ${mViews ? ((inter / mViews) * 100).toFixed(2) : "0"}%`;
    })
    .join("\n");

  const trendText = last7
    .map(
      (d) =>
        `- ${d.date.toISOString().slice(0, 10)}: ${fmt(d._sum.views ?? 0)} views, ${fmt((d._sum.likes ?? 0) + (d._sum.replies ?? 0))} interaksi`
    )
    .join("\n");

  const text = `DATA LIVE JARINGAN AKUN THREADS SUKA SHAWARMA (dari database):
Ringkasan: ${accounts.length} akun | ${fmt(totalFollowers)} total followers seluruh jaringan | ${fmt(postsTotal)} postingan | ${fmt(views)} views | ${fmt(interactions)} interaksi | ER rata-rata ${er}%

DATA JUMLAH FOLLOWERS SEMUA AKUN (dari insight Threads di database):
${byFollowers.map((a, i) => `${i + 1}. @${a.username} (${a.displayName}): ${fmt(a.followers)} followers`).join("\n")}

PERINGKAT VIEWS (top 10 akun):
${byViews.slice(0, 10).map((a, i) => `${i + 1}. @${a.username}: ${fmt(a.views)} views, ${fmt(a.followers)} followers, ${fmt(a.likes)} suka, ${fmt(a.replies)} balasan`).join("\n")}

PERINGKAT JUMLAH POSTINGAN (top 10 akun):
${byPosts.slice(0, 10).map((a, i) => `${i + 1}. @${a.username}: ${fmt(a.posts)} post, ${fmt(a.followers)} followers`).join("\n")}

PERFORMA PER FORMAT KONTEN (sepanjang data):
${mediaText}

TREN 7 HARI TERAKHIR (seluruh jaringan):
${trendText}

10 POSTINGAN DENGAN VIEWS TERTINGGI SEPANJANG DATA (bukan tren terbaru):
${top.map((p, i) => `${i + 1}. @${p.username} [${p.media}] ${fmt(p.views)} views, ${p.likes} suka, ${p.replies} balasan: "${clip(p.text, 180)}"`).join("\n")}

5 POSTINGAN TERLEMAH (views rendah, sudah lewat 3 hari):
${flopPosts.map((p, i) => `${i + 1}. @${p.threadsAccount?.username || "unknown"} ${fmt(p.views)} views, ${p.likes} suka, ${p.replies} balasan: "${clip(p.text, 140)}"`).join("\n")}`;

  return {
    text,
    totals: { accounts: accounts.length, posts: postsTotal, views, interactions, er, followers: totalFollowers },
    byPosts,
    byViews,
    byFollowers,
    topPosts: top.map((p) => ({ username: p.username, text: p.text, views: p.views })),
    usernames: accounts.map((a) => a.username).filter((u): u is string => !!u),
  };
}

export async function getFleetContext(): Promise<FleetContext> {
  const key = scopeKey();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await loadFleet();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Maksimal akun yang dirinci dalam satu jawaban (perbandingan antar akun). */
const MAX_DETAIL_ACCOUNTS = 3;
const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;

/** Akun yang disebut pesan lewat username atau nama tampilnya (paling spesifik lebih dulu). */
function matchAccounts<T extends { username: string | null; displayName: string }>(
  message: string,
  accounts: T[]
): T[] {
  const norm = (s: string) => s.toLowerCase().replace(/[@_\s.-]/g, "");
  const qNorm = norm(message);
  const len = (a: T) => Math.max((a.username || "").length, (a.displayName || "").length);
  return accounts
    .filter((a) => {
      const uNorm = norm(a.username || "");
      const dNorm = norm(a.displayName || "");
      return (uNorm.length >= 3 && qNorm.includes(uNorm)) || (dNorm.length >= 3 && qNorm.includes(dNorm));
    })
    .sort((a, b) => len(b) - len(a))
    .slice(0, MAX_DETAIL_ACCOUNTS);
}

/**
 * Detail akun yang disebut pesan: total, perubahan 7 hari, kualitas post (median), format, jam terbaik,
 * peringkat, dan postingan terbaru. Semua angka dihitung di database/server, bukan oleh AI.
 */
export async function getAccountDetail(
  message: string,
  usernames: string[] = []
): Promise<string> {
  void usernames;
  const accounts = await onlyVisible(
    await must<{ id: string; username: string | null; displayName: string }[]>(
      db().from("ThreadsAccount").select("id, username, displayName")
    )
  );
  const hits = matchAccounts(message, accounts);
  if (hits.length === 0) return "";

  const ids = hits.map((h) => h.id);
  const now = new Date();
  const to = await agg.dailyMaxDate(ids);
  const from = to ? new Date(to.getTime() - 6 * DAY_MS) : null;
  const prevTo = from ? new Date(from.getTime() - DAY_MS) : null;
  const prevFrom = prevTo ? new Date(prevTo.getTime() - 6 * DAY_MS) : null;

  const [lifetime, windowCur, windowPrev, postCounts, winPosts, latest, stats, fleet, hours, aiCtx, topRows] =
    await Promise.all([
      agg.dailyByAccount({ ids }),
      from && to ? agg.dailyByAccount({ ids, from, to }) : Promise.resolve([]),
      prevFrom && prevTo ? agg.dailyByAccount({ ids, from: prevFrom, to: prevTo }) : Promise.resolve([]),
      agg.postsByAccount({ ids }),
      from && to
        ? agg.postsByAccount({
            ids,
            from: new Date(from.getTime() - WIB_OFFSET_MS),
            to: new Date(to.getTime() + DAY_MS - WIB_OFFSET_MS),
          })
        : Promise.resolve([]),
      agg.latestFollowers({ ids }),
      loadPostStats(new Date(Date.now() - 30 * DAY_MS), ids).catch(() => []),
      getFleetContext().catch(() => null),
      bestHoursForAccounts(ids, now).catch(() => new Map()),
      rpc<{
        recents?: Array<{ aid: string; text: string; views: number; rn: number }>;
        formats?: Array<{ aid: string; mediaType: string; n: number; avgViews: number; er: number }>;
      }>("dash_ai_context", { p_ids: ids, p_now: now }).catch(() => ({ recents: [], formats: [] })),
      Promise.all(
        ids.map((id) =>
          must<{ text: string; views: number; likes: number; replies: number; mediaType: string }[]>(
            db()
              .from("ThreadsPostStat")
              .select("text, views, likes, replies, mediaType")
              .eq("threadsAccountId", id)
              .order("views", { ascending: false })
              .limit(5)
          )
        )
      ),
    ]);

  const by = <T extends object>(rows: T[], id: string): T | undefined =>
    rows.find((r) => {
      const k = r as { threadsAccountId?: string; aid?: string };
      return (k.threadsAccountId ?? k.aid) === id;
    });
  const fmtN = (n: number) => n.toLocaleString("id-ID");

  return hits
    .map((hit, idx) => {
      const handle = hit.username || hit.displayName;
      const life = by(lifetime, hit.id);
      const views = life?.views ?? 0;
      const inter = (life?.likes ?? 0) + (life?.replies ?? 0);
      const fol = by(latest, hit.id);
      const posts = by(postCounts, hit.id)?.posts ?? 0;
      const lines: string[] = [`DETAIL AKUN YANG DITANYAKAN (@${handle}, ${hit.displayName}):`];

      lines.push(
        `- Followers: ${fmtN(fol?.followers ?? 0)}${fol?.date ? ` (insight Threads per ${toDate(fol.date).toISOString().slice(0, 10)})` : ""}`,
        `- Total: ${fmtN(posts)} post, ${fmtN(views)} views, ${fmtN(inter)} interaksi (suka dan balasan), ER ${views ? ((inter / views) * 100).toFixed(2) : "0"}%`
      );
      if (fol?.followers) lines.push(`- Views per follower: ${fmtN(Math.round(views / fol.followers))}`);
      if (fleet) {
        const rank = fleet.byViews.findIndex((a) => a.username === handle) + 1;
        if (rank > 0) lines.push(`- Peringkat views seluruh jaringan: ${rank} dari ${fleet.byViews.length} akun`);
      }

      const cur = by(windowCur, hit.id);
      const prev = by(windowPrev, hit.id);
      if (from && to && cur) {
        const p = prev?.views ?? 0;
        const delta = p >= 100 ? Math.round(((cur.views - p) / p) * 100) : null;
        lines.push(
          `- 7 hari terakhir (${from.toISOString().slice(0, 10)} s/d ${to.toISOString().slice(0, 10)}): ${fmtN(cur.views)} views, ${by(winPosts, hit.id)?.posts ?? 0} post baru` +
            (prev
              ? `; 7 hari sebelumnya ${fmtN(p)} views${delta === null ? "" : ` (${delta >= 0 ? "naik" : "turun"} ${Math.abs(delta)}%)`}`
              : "; belum ada pembanding periode sebelumnya")
        );
      }

      const st = by(stats, hit.id);
      if (st) {
        lines.push(
          `- Postingan 30 hari terakhir: ${st.n} post, median ${fmtN(st.median)} views/post, rata-rata ${fmtN(st.avg)}, tertinggi ${fmtN(st.max)}, ${st.low} post dengan <=1 view`
        );
      }

      const formats = (aiCtx.formats ?? []).filter((f) => f.aid === hit.id);
      if (formats.length) {
        lines.push(
          `- Format 60 hari terakhir: ${formats
            .map((f) => `${MEDIA_LABEL[f.mediaType] || f.mediaType} ${f.n} post, rata-rata ${fmtN(f.avgViews)} views, ER ${f.er}%`)
            .join("; ")}`
        );
      }

      const hr = (hours as Map<string, { best: Array<{ h: number; avgViews: number; posts: number }>; source: string }>).get(hit.id);
      if (hr?.best.length) {
        lines.push(
          `- Jam terbaik (WIB, ${hr.source === "account" ? "dari data akun ini" : "dari pola jaringan karena data akun ini kurang"}): ${hr.best
            .slice(0, 3)
            .map((b) => `${String(b.h).padStart(2, "0")}:00 (rata-rata ${fmtN(b.avgViews)} views, ${b.posts} post)`)
            .join("; ")}`
        );
      }

      const recent = (aiCtx.recents ?? []).filter((r) => r.aid === hit.id).slice(0, 8);
      if (recent.length) {
        lines.push(
          `Postingan terbaru (14 hari, urut terbaru):`,
          ...recent.map((r, i) => `${i + 1}. ${fmtN(r.views)} views: "${clip(r.text, 110)}"`)
        );
      }

      const top = topRows[idx] ?? [];
      if (top.length) {
        lines.push(
          `Postingan terbaik sepanjang data:`,
          ...top.map(
            (p, i) =>
              `${i + 1}. [${MEDIA_LABEL[p.mediaType] || p.mediaType}] ${fmtN(p.views)} views, ${p.likes} suka, ${p.replies} balasan: "${clip(p.text, 140)}"`
          )
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
