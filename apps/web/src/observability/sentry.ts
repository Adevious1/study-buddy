import * as Sentry from '@sentry/react';
import { scrubWebEvent, type WebScrubbableEvent } from './scrub';

/**
 * Browser error tracking (SP10). VITE_SENTRY_DSN unset → fully disabled.
 * Session Replay must NEVER be enabled — it would screen-record the live
 * transcript and snapshot previews (kids' data). Console breadcrumbs are off
 * for the same reason: the voice UI logs transcript-adjacent state.
 */
export function initWebSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Providing an array ADDS to defaults, but same-name integrations dedupe:
    // filterDuplicates() keeps the last instance with the same name, and user
    // instances (no isDefaultInstance flag) win over default instances. Our
    // breadcrumbsIntegration({ console: false }) therefore replaces the default
    // Breadcrumbs integration that has console:true. Verified against
    // @sentry/core@10.57.0 src (integration.js filterDuplicates).
    integrations: [Sentry.breadcrumbsIntegration({ console: false })],
    beforeSend: (event) =>
      scrubWebEvent(event as unknown as WebScrubbableEvent) as unknown as typeof event,
  });
}
