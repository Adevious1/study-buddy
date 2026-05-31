import type { MeResponse } from '@study-buddy/shared';

export type OnboardingDest = '/subscribe' | '/onboarding' | '/switch' | '/app' | null;

/**
 * Where to send a signed-in guardian entering /app.
 * - not entitled (trial ended / no active subscription) → /subscribe (paywall)
 * - brand new (no children) → /onboarding
 * - has children but none active → /switch (picker)
 * - has children and a valid active child → null (stay on /app)
 */
export function nextOnboardingDest(me: MeResponse, activeChildId: string | null): OnboardingDest {
  if (!me.entitlement.entitled) return '/subscribe';
  if (me.children.length === 0) return '/onboarding';
  const activeIsValid = activeChildId != null && me.children.some((c) => c.id === activeChildId);
  if (!activeIsValid) return '/switch';
  return null; // stay on /app
}
