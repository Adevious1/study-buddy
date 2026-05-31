const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export async function startCheckout(): Promise<void> {
  const res = await fetch(`${base}/me/billing/checkout`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`checkout ${res.status}`);
  const { url } = await res.json() as { url: string };
  window.location.assign(url);
}

export async function openPortal(): Promise<void> {
  const res = await fetch(`${base}/me/billing/portal`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`portal ${res.status}`);
  const { url } = await res.json() as { url: string };
  window.location.assign(url);
}
