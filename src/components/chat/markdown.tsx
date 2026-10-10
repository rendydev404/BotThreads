import React from "react";

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
  | { type: "h"; text: string }
  | { type: "hr" }
  | { type: "quote"; text: string }
  | { type: "ul" | "ol"; items: Item[] }
  | { type: "code"; text: string };

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
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", text: code.join("\n") });
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

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "h", text: heading[1] });
      i++;
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
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = React.useMemo(() => parse(text), [text]);

  return (
    <div className="space-y-3">
      {blocks.map((b, idx) => {
        const key = `b${idx}`;
        switch (b.type) {
          case "h":
            return (
              <p key={key} className="font-semibold text-[15px] pt-1">
                {renderInline(b.text, key)}
              </p>
            );
          case "hr":
            return <hr key={key} className="border-line" />;
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-[3px] border-accent/50 bg-subtle rounded-r-lg pl-4 pr-3 py-2.5 whitespace-pre-line"
              >
                {renderInline(b.text, key)}
              </blockquote>
            );
          case "ul":
          case "ol": {
            const Tag = b.type;
            return (
              <Tag
                key={key}
                className={
                  b.type === "ul"
                    ? "list-disc pl-5 space-y-1.5 marker:text-faint"
                    : "list-decimal pl-5 space-y-1.5 marker:text-muted"
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
          case "code":
            return (
              <pre
                key={key}
                className="p-3 rounded-lg bg-line/60 text-[13px] font-mono overflow-x-auto whitespace-pre"
              >
                {b.text}
              </pre>
            );
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
