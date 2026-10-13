import React from "react";
import { cn } from "@/lib/utils";
import {
  BAR_LANG,
  STAT_LANG,
  isTableStart,
  parseBars,
  parseCallout,
  parseStats,
  parseTable,
  type TableData,
} from "@/lib/rich-blocks";
import { BarChart, Callout, RichTable, StatGrid } from "./markdown-blocks";

/**
 * Renderer markdown ringan untuk jawaban AI: judul, **tebal**, *miring*,
 * `kode`, daftar (termasuk bertingkat), kutipan, garis pemisah, blok kode.
 * Tanpa dependensi dan tanpa dangerouslySetInnerHTML, jadi aman dari injeksi HTML.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="px-1 py-0.5 rounded bg-line/70 text-[0.9em] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

interface Item {
  text: string;
  depth: number;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "table"; table: TableData }
  | { type: "hr" }
  | { type: "quote"; text: string }
  | { type: "ul" | "ol"; items: Item[] }
  | { type: "code"; text: string; lang: string };

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBER = /^(\s*)\d+[.)]\s+(.*)$/;
const startsBlock = (l: string) =>
  BULLET.test(l) ||
  NUMBER.test(l) ||
  /^#{1,4}\s/.test(l) ||
  /^\s*>/.test(l) ||
  /^\s*(-{3,}|\*{3,})\s*$/.test(l) ||
  l.trim().startsWith("```");

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", text: code.join("\n"), lang });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "h", level: heading[1].length as 1 | 2 | 3 | 4, text: heading[2].replace(/\s+#+\s*$/, "") });
      i++;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const { table, next } = parseTable(lines, i);
      blocks.push({ type: "table", table });
      i = next;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: quote.join("\n").trim() });
      continue;
    }

    const isBullet = BULLET.test(line);
    if (isBullet || NUMBER.test(line)) {
      const re = isBullet ? BULLET : NUMBER;
      const items: Item[] = [];
      while (i < lines.length) {
        const m = lines[i].match(re);
        if (m) {
          items.push({ text: m[2], depth: m[1].length >= 2 ? 1 : 0 });
          i++;
        } else if (lines[i].trim() && !startsBlock(lines[i]) && items.length) {
          // baris lanjutan dari item sebelumnya
          items[items.length - 1].text += " " + lines[i].trim();
          i++;
        } else if (!lines[i].trim() && re.test(lines[i + 1] ?? "")) {
          i++; // baris kosong di antara item daftar yang sama
        } else {
          break;
        }
      }
      blocks.push({ type: isBullet ? "ul" : "ol", items });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !startsBlock(lines[i]) &&
      !isTableStart(lines[i], lines[i + 1])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

/** Render khusus blok kode berbahasa tertentu; kembalikan null untuk tampilan kode biasa. */
export type CodeRenderer = (lang: string, code: string, key: string, ordinal: number) => React.ReactNode | null;

export function Markdown({ text, renderCode }: { text: string; renderCode?: CodeRenderer }) {
  const blocks = React.useMemo(() => parse(text), [text]);
  // Nomor urut per bahasa blok kode (mis. kartu ide 1, 2, 3), dihitung ulang tiap render.
  const ordinals = React.useMemo(() => {
    const seen = new Map<string, number>();
    return blocks.map((b) => {
      if (b.type !== "code") return 0;
      const n = (seen.get(b.lang) ?? 0) + 1;
      seen.set(b.lang, n);
      return n;
    });
  }, [blocks]);

  return (
    <div className={cn("space-y-3.5")}>
      {blocks.map((b, idx) => {
        const key = `b${idx}`;
        switch (b.type) {
          case "h": {
            const inner = renderInline(b.text, key);
            if (b.level === 1)
              return (
                <h2 key={key} className="pt-2 text-xl font-bold text-fg leading-snug tracking-tight">
                  {inner}
                </h2>
              );
            if (b.level === 2)
              return (
                <h3
                  key={key}
                  className="pt-2 flex items-center gap-2.5 text-[17px] font-bold text-fg leading-snug"
                >
                  <span className="w-1 h-5 rounded-full bg-gradient-to-b from-accent to-violet-500 shrink-0" aria-hidden />
                  {inner}
                </h3>
              );
            if (b.level === 3)
              return (
                <h4 key={key} className="pt-1 text-[15px] font-semibold text-fg">
                  {inner}
                </h4>
              );
            return (
              <h5 key={key} className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">
                {inner}
              </h5>
            );
          }
          case "table":
            return <RichTable key={key} data={b.table} inline={renderInline} keyPrefix={key} />;
          case "hr":
            return <hr key={key} className="border-line" />;
          case "quote": {
            const callout = parseCallout(b.text);
            if (callout) {
              return (
                <Callout key={key} kind={callout.kind} title={callout.title}>
                  {callout.body ? <Markdown text={callout.body} /> : null}
                </Callout>
              );
            }
            return (
              <blockquote
                key={key}
                className="border-l-[3px] border-accent/50 bg-subtle rounded-r-lg pl-4 pr-3 py-2.5 whitespace-pre-line"
              >
                {renderInline(b.text, key)}
              </blockquote>
            );
          }
          case "ul":
          case "ol": {
            const Tag = b.type;
            return (
              <Tag
                key={key}
                className={
                  b.type === "ul"
                    ? "list-disc pl-5 space-y-1.5 marker:text-accent/60"
                    : "list-decimal pl-5 space-y-1.5 marker:font-semibold marker:text-accent"
                }
              >
                {b.items.map((it, j) => (
                  <li key={j} className={it.depth ? "ml-5 list-[circle]" : undefined}>
                    {renderInline(it.text, `${key}-${j}`)}
                  </li>
                ))}
              </Tag>
            );
          }
          case "code": {
            if (b.lang === BAR_LANG) {
              const data = parseBars(b.text);
              if (data) return <BarChart key={key} data={data} />;
            }
            if (b.lang === STAT_LANG) {
              const items = parseStats(b.text);
              if (items.length) return <StatGrid key={key} items={items} />;
            }
            const custom = renderCode?.(b.lang, b.text, key, ordinals[idx]);
            if (custom) return <React.Fragment key={key}>{custom}</React.Fragment>;
            return (
              <pre
                key={key}
                className="p-3 rounded-lg bg-line/60 text-[13px] font-mono overflow-x-auto whitespace-pre"
              >
                {b.text}
              </pre>
            );
          }
          default:
            return (
              <p key={key} className="whitespace-pre-line">
                {renderInline(b.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
