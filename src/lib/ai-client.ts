/**
 * Klien fetch untuk fitur AI per akun: edit dengan AI, agen onboarding, dan Profil AI (memori gaya).
 * Aman dipakai di komponen "use client" (hanya mengimpor tipe).
 */
import type { LessonDTO } from "./account-memory";
import type { OnboardingDTO, SuggestedProfile } from "./account-onboarding";
import type { AutopilotPillar, VoiceStyle } from "./autopilot-types";
import type { EditAction, EditResult } from "./content-ai";
import { call } from "./content-client";

export type { EditAction, EditCandidate, EditResult } from "./content-ai";
export type { LessonDTO } from "./account-memory";
export type { OnboardingDTO, OnboardStep, OnboardStepKey, OnboardStepStatus, SuggestedProfile } from "./account-onboarding";

export const aiEditPost = (postId: string, body: { action: EditAction; instruction?: string; text?: string }, signal?: AbortSignal) =>
  call<EditResult & { success: true }>(`/api/content/posts/${encodeURIComponent(postId)}/ai`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });

export const fetchOnboarding = (signal?: AbortSignal) =>
  call<{ success: true; items: OnboardingDTO[] }>("/api/threads/onboarding", { signal, cache: "no-store" });

export const runOnboardingAgent = (accountId: string) =>
  call<{ success: true }>("/api/threads/onboarding", { method: "POST", body: JSON.stringify({ accountId }) });

export interface AiProfileResponse {
  success: true;
  profile: { brief: string | null; voiceStyle: VoiceStyle | null; pillars: AutopilotPillar[] };
  lessons: LessonDTO[];
}

export const fetchAiProfile = (accountId: string) =>
  call<AiProfileResponse>(`/api/threads/ai-profile?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });

export const suggestAiProfile = (accountId: string) =>
  call<{ success: true; suggestion: SuggestedProfile }>("/api/threads/ai-profile", {
    method: "POST",
    body: JSON.stringify({ accountId, action: "suggest" }),
  });

export const addStyleLesson = (accountId: string, text: string) =>
  call<{ success: true; lesson: LessonDTO }>("/api/threads/ai-profile", {
    method: "POST",
    body: JSON.stringify({ accountId, action: "lesson", text }),
  });

export const removeStyleLesson = (accountId: string, lessonId: string) =>
  call<{ success: true }>("/api/threads/ai-profile", { method: "DELETE", body: JSON.stringify({ accountId, lessonId }) });
