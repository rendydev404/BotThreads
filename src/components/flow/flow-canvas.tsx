"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { Bot, CircleCheck, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOW_STEPS, type FlowStep, type FlowStepId } from "@/lib/system-flow";
import { STEP_ICONS } from "./step-icons";
import { useT } from "@/components/i18n/lang-provider";

/**
 * Peta alur BotThreads (React Flow). Hanya untuk dibaca: tidak bisa digeser, di-zoom, atau disambung,
 * supaya terasa seperti diagram, bukan editor. Dimuat terpisah (lihat system-flow.tsx) karena
 * pustakanya hanya dibutuhkan di layar lebar.
 */

const NODE_W = 220;

/** Posisi tetap: jalur "Anda, sekali di awal" di kiri, siklus harian otomatis di kanan. */
const POS: Record<FlowStepId, { x: number; y: number }> = {
  hubungkan: { x: 0, y: 0 },
  kenalkan: { x: 0, y: 200 },
  ide: { x: 300, y: 0 },
  tulis: { x: 560, y: 0 },
  terbit: { x: 820, y: 0 },
  pantau: { x: 820, y: 200 },
};

type StepData = { step: FlowStep; selected: boolean; done: boolean; onSelect: (id: FlowStepId) => void };
type LaneData = { label: string; tone: "anda" | "otomatis" };
type StepNode = Node<StepData, "step">;
type LaneNode = Node<LaneData, "lane">;

const HIDDEN_HANDLE = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

const StepCard = memo(function StepCard({ data }: NodeProps<StepNode>) {
  const { step, selected, done, onSelect } = data;
  const Icon = STEP_ICONS[step.id];
  const auto = step.by === "otomatis";
  const t = useT();
  return (
    <>
      <Handle id="t" type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      <Handle id="l" type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <Handle id="bt" type="target" position={Position.Bottom} style={HIDDEN_HANDLE} />
      <button
        type="button"
        onClick={() => onSelect(step.id)}
        aria-pressed={selected}
        className={cn(
          "nodrag w-full text-left rounded-2xl border bg-surface p-4 transition-[box-shadow,border-color,transform] duration-200 cursor-pointer",
          "hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent",
          selected ? "border-accent shadow-pop ring-4 ring-accent-soft" : "border-line hover:border-line-strong"
        )}
        style={{ width: NODE_W }}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              auto ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning"
            )}
          >
            <Icon className="w-5 h-5" />
          </span>
          {done ? (
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-success-soft text-success text-[11px] font-bold">
              <CircleCheck className="w-3.5 h-3.5" />
              {t("Selesai")}
            </span>
          ) : (
            <span className="text-xs font-bold text-faint tabular-nums">{t("Langkah {no}", { no: step.no })}</span>
          )}
        </span>
        <span className="mt-3 block text-[15px] font-bold text-fg leading-snug">{t(step.title)}</span>
        <span className="mt-1 block text-[13px] text-muted leading-snug">{t(step.short)}</span>
        <span
          className={cn(
            "mt-3 inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-bold",
            auto ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning"
          )}
        >
          {auto ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
          {auto ? t("Otomatis") : t("Anda")}
        </span>
      </button>
      <Handle id="r" type="source" position={Position.Right} style={HIDDEN_HANDLE} />
      <Handle id="b" type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
      <Handle id="ls" type="source" position={Position.Left} style={HIDDEN_HANDLE} />
    </>
  );
});

const Lane = memo(function Lane({ data, width, height }: NodeProps<LaneNode>) {
  const t = useT();
  return (
    <div
      className={cn("rounded-3xl border border-dashed", data.tone === "anda" ? "border-warning/40 bg-warning-soft/40" : "border-accent/40 bg-accent-soft/30")}
      style={{ width, height }}
    >
      <p className={cn("px-4 pt-3 text-[11px] font-bold tracking-widest", data.tone === "anda" ? "text-warning" : "text-accent")}>{t(data.label)}</p>
    </div>
  );
});

const nodeTypes = { step: StepCard, lane: Lane };

const autoEdge = (id: string, source: string, target: string, sourceHandle: string, targetHandle: string, label?: string): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  type: "smoothstep",
  animated: true,
  label,
  labelStyle: { fill: "var(--color-accent)", fontSize: 12, fontWeight: 700 },
  labelBgStyle: { fill: "var(--color-surface)" },
  labelBgPadding: [8, 4],
  labelBgBorderRadius: 6,
  style: { stroke: "var(--color-accent)", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-accent)", width: 16, height: 16 },
});

const EDGES: Edge[] = [
  {
    id: "e1-2",
    source: "hubungkan",
    target: "kenalkan",
    sourceHandle: "b",
    targetHandle: "t",
    type: "smoothstep",
    style: { stroke: "var(--color-warning)", strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-warning)", width: 16, height: 16 },
  },
  autoEdge("e2-3", "kenalkan", "ide", "r", "l", "lalu berjalan sendiri"),
  autoEdge("e3-4", "ide", "tulis", "r", "l"),
  autoEdge("e4-5", "tulis", "terbit", "r", "l"),
  autoEdge("e5-6", "terbit", "pantau", "b", "t"),
  autoEdge("e6-3", "pantau", "ide", "ls", "bt", "hasilnya jadi bahan ide besok"),
];

const LANES: LaneNode[] = [
  {
    id: "lane-anda",
    type: "lane",
    position: { x: -18, y: -50 },
    width: NODE_W + 36,
    height: 450,
    data: { label: "ANDA · SEKALI DI AWAL", tone: "anda" },
    selectable: false,
    draggable: false,
    focusable: false,
    zIndex: -1,
  },
  {
    id: "lane-otomatis",
    type: "lane",
    position: { x: 282, y: -50 },
    width: 820 - 300 + NODE_W + 36,
    height: 450,
    data: { label: "OTOMATIS · SETIAP HARI", tone: "otomatis" },
    selectable: false,
    draggable: false,
    focusable: false,
    zIndex: -1,
  },
];

export interface FlowCanvasProps {
  selectedId: FlowStepId;
  doneIds: FlowStepId[];
  onSelect: (id: FlowStepId) => void;
}

export default function FlowCanvas({ selectedId, doneIds, onSelect }: FlowCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<StepNode | LaneNode> | null>(null);
  const t = useT();
  const edges = useMemo(() => EDGES.map((e) => (typeof e.label === "string" ? { ...e, label: t(e.label) } : e)), [t]);

  const nodes = useMemo<(StepNode | LaneNode)[]>(
    () => [
      ...LANES,
      ...FLOW_STEPS.map<StepNode>((step) => ({
        id: step.id,
        type: "step",
        position: POS[step.id],
        data: { step, selected: step.id === selectedId, done: doneIds.includes(step.id), onSelect },
        draggable: false,
        selectable: false,
        focusable: false,
      })),
    ],
    [selectedId, doneIds, onSelect]
  );

  // Diagram selalu muat penuh di lebar wadahnya, juga saat jendela diubah ukurannya.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => flowRef.current?.fitView({ padding: 0.04 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="bt-flow h-[470px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(inst) => {
          flowRef.current = inst;
          inst.fitView({ padding: 0.04 });
        }}
        fitView
        fitViewOptions={{ padding: 0.04 }}
        minZoom={0.4}
        maxZoom={1.1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        attributionPosition="bottom-right"
        aria-label={t("Peta alur kerja BotThreads")}
      />
    </div>
  );
}
