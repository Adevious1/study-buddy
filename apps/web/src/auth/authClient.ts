import { createAuthClient } from 'better-auth/react';

// Same-origin: the browser reaches /api/auth via the Vite proxy (dev) or the
// served origin (docker). baseURL defaults to window.location.origin.
export const authClient = createAuthClient();
export const { useSession, signIn, signOut } = authClient;
