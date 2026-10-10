/** Hanya izinkan redirect ke path internal (cegah open redirect). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }
  if (next.startsWith("/login") || next.startsWith("/api/")) return "/";
  return next;
}
