import type { MeResponse } from '@study-buddy/shared';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export async function repositoryMe(): Promise<MeResponse> {
  const res = await fetch(`${base}/me`, { credentials: 'include' });
  if (!res.ok) throw new Error(`me ${res.status}`);
  return (await res.json()) as MeResponse;
}
