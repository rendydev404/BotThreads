import React from "react";
import { CircleAlert, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deltaTone,
  numericColumns,
  type BarChartData,
  type CalloutKind,
  type StatItem,
  type TableData,
  type Tone,
} from "@/lib/rich-blocks";

/** Pewarna teks perubahan: naik hijau, turun merah, selain itu netral. */
const TONE_TEXT: Record<Tone, string> = {
  up: "text-success",
  down: "text-danger",
  flat: "text-muted",
};

type Inline = (text: string, key: string) => React.ReactNode;

/** Tabel data: bergulir horizontal di layar sempit, kolom angka rata kanan, perubahan berwarna. */
export function RichTable({ data, inline, keyPrefix }: { data: TableData; inline: Inline; keyPrefix: string }) {
  const numeric = numericColumns(data);
  const alignClass = (c: number) =>
    data.align[c] === "right" || (data.align[c] === "left" && numeric[c])
      ? "text-right tabular-nums"
      : data.align[c] === "center"
        ? "text-center"
        : "text-left";

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-[13px] border-collapse">
          <thead>
            <tr className="bg-subtle">
              {data.header.map((h, c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    "px-3.5 py-2.5 text-xs font-semibold text-muted whitespace-nowrap border-b border-line",
                    alignClass(c)
                  )}
                >
                  {inline(h, `${keyPrefix}-h${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-b-0 hover:bg-subtle/60 transition-colors">
                {row.map((cell, c) => {
                  const plain = cell.replace(/\*\*/g, "");
                  const tone = numeric[c] ? deltaTone(plain) : "flat";
                  return (
                    <td
                      key={c}
                      className={cn(
                        "px-3.5 py-2.5 align-top",
                        alignClass(c),
                        c === 0 && !numeric[c] && "font-medium text-fg",
                        tone !== "flat" && cn(TONE_TEXT[tone], "font-medium")
                      )}
                    >
                      {inline(cell, `${keyPrefix}-${r}-${c}`)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Diagram batang horizontal: lebar relatif ke nilai terbesar (atau 0-100 untuk persen). */
export function BarChart({ data }: { data: BarChartData }) {
  return (
    <figure className="rounded-xl border border-line bg-surface p-4">
      {data.title && (
        <figcaption className="mb-3 text-xs font-semibold text-muted">{data.title}</figcaption>
      )}
      <ul className="space-y-3" aria-label={data.title ?? "Diagram batang"}>
        {data.rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,8rem)_minmax(3rem,1fr)_auto] items-center gap-3 text-[13px]">
            <span className="truncate font-medium text-fg" title={r.label}>
              {r.label}
            </span>
            <span className="h-2.5 rounded-full bg-subtle overflow-hidden" aria-hidden>
              <span
                className="block h-full origin-left rounded-full bg-gradient-to-r from-accent to-violet-500 bar-grow"
                style={{ width: `${Math.max(r.ratio * 100, r.value > 0 ? 2 : 0)}%`, animationDelay: `${i * 60}ms` }}
              />
            </span>
            <span className="text-right tabular-nums whitespace-nowrap">
              <span className="font-semibold text-fg">{r.valueText}</span>
              {r.note && (
                <span className={cn("ml-1.5 text-xs font-medium", TONE_TEXT[deltaTone(r.note)])}>{r.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Deretan angka ringkas (KPI). */
export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {items.map((s, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface px-3.5 py-3 min-w-0">
          <dt className="text-xs text-muted truncate">{s.label}</dt>
          <dd className="mt-1 text-xl font-bold text-fg tabular-nums leading-tight break-words">{s.value}</dd>
          {s.note && (
            <dd className={cn("mt-0.5 text-xs font-medium", TONE_TEXT[deltaTone(s.note)])}>{s.note}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

const CALLOUT_STYLE: Record<CalloutKind, { box: string; title: string; icon: React.ComponentType<{ className?: string }> }> = {
  note: { box: "bg-subtle border-line", title: "text-muted", icon: Info },
  tip: { box: "bg-success-soft border-success/30", title: "text-success", icon: Lightbulb },
  warning: { box: "bg-warning-soft border-warning/30", title: "text-warning", icon: TriangleAlert },
  key: { box: "bg-accent-soft border-accent/30", title: "text-accent", icon: CircleAlert },
};

export function Callout({
  kind,
  title,
  children,
}: {
  kind: CalloutKind;
  title: string;
  children?: React.ReactNode;
}) {
  const s = CALLOUT_STYLE[kind];
  const Icon = s.icon;
  return (
    <aside className={cn("rounded-xl border px-4 py-3", s.box)}>
      <p className={cn("flex items-center gap-2 text-[13px] font-semibold", s.title)}>
        <Icon className="w-4 h-4 shrink-0" />
        {title}
      </p>
      {children && <div className="mt-1.5 text-fg">{children}</div>}
    </aside>
  );
}
