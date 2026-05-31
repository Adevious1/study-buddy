# SP6 — Session Recap manual smoke

**Prereqs:** full stack up (`docker compose up`), `GEMINI_API_KEY` set, and the
`transcript` migration applied (the server applies migrations on boot via
`docker-entrypoint.sh`; if you changed schema since the last boot, run
`docker compose restart server`). Needs a real microphone + a human — Playwright
cannot produce real mic audio.

## Happy path (completed → recap)
1. Sign in (`parent@studybuddy.dev` / `studybuddy`), pick a child, enter the app.
2. Start a voice session and have a short real tutoring exchange (work one small
   problem; let Pip guide you to it).
3. Tap **End**.
   - ✅ The "Putting together what you learned…" screen shows immediately.
   - ✅ After a few seconds you land on the recap at `/app/recap`, populated:
     stars (out of 3), "Solved it yourself" count, a "What we figured out" list
     reflecting the actual session, and a "Pip noticed…" insight.
4. Reload `/app/recap` — the same recap loads (it is persisted).

## Persistence check (DB)
- `docker compose exec -T postgres psql -U studybuddy -d studybuddy -c "select state, stars_earned, jsonb_array_length(transcript) as turns, insight_badge from sessions order by ended_at desc nulls last limit 3;"`
  - ✅ Latest completed row has non-null `stars_earned`, `insight_badge`, and a
    `turns` count > 0.

## Tunable prompt check
- Edit `apps/server/study-buddy-recap.md` (e.g. change the insightBadge guidance),
  save, run a new session, End. ✅ Next recap reflects the edit with no restart
  (the file is bind-mounted and read fresh each session). Revert the edit
  afterward, or the drift-guard test will fail until `BUILTIN_RECAP_TEMPLATE`
  matches.

## Fallback check (optional)
- Temporarily set an invalid `GEMINI_API_KEY` for the server, restart, run a
  session, End. ✅ The recap still renders a graceful, encouraging fallback
  (1 star, "We had a great session together!", "GREAT EFFORT") rather than a
  broken/empty screen. Restore the key afterward.

## Abandoned path
- Start a session, then navigate away / close the tab instead of tapping End.
  ✅ No recap is generated for that session (the `/app/recap` still shows the last
  *completed* session), but its transcript IS persisted (`state = 'abandoned'`,
  `transcript` non-null, recap columns null).

## Privacy note
Transcripts are now stored PII. For a real product, add retention/redaction.
This is acceptable for the dev project.
