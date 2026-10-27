import { BookUser, CalendarClock, ChartLine, Lightbulb, Link2, PenLine, type LucideIcon } from "lucide-react";
import type { FlowStepId } from "@/lib/system-flow";

export const STEP_ICONS: Record<FlowStepId, LucideIcon> = {
  hubungkan: Link2,
  kenalkan: BookUser,
  ide: Lightbulb,
  tulis: PenLine,
  terbit: CalendarClock,
  pantau: ChartLine,
};
