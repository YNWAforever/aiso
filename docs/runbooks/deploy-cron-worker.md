# Runbook: deploy the cron-triggering Cloudflare Worker

**When to run this:** after `cloudflare/cron-worker/` is merged, to actually start
scheduling `cron/pulse`, `cron/evaluate-alerts`, and `cron/trial-emails` from
Cloudflare instead of Vercel.

**Who runs it:** a human with access to this project's Cloudflare account and
the Vercel project's `CRON_SECRET` value. An agent must not read or type the
secret — copy it directly between your password manager / Vercel's dashboard
and the command below.

**Before you start — read this:** merging this branch's `vercel.json` change (commit
`199d598`) already removed Vercel Cron's `crons` array. From that merge until you complete
this runbook, **nothing schedules `cron/pulse`, `cron/evaluate-alerts`, or `cron/trial-emails`
at all** — not a double-scheduling risk (the three routes are idempotent), but a real gap
where the weekly Pulse rollup, alert evaluation, and the trial drip campaign all silently
stop running. Run this runbook as close to that merge as practical, ideally the same day.

## Procedure

1. **Install dependencies**, if not already done:

       cd cloudflare/cron-worker && npm install

2. **Authenticate wrangler**, if this machine hasn't before:

       npx wrangler login

3. **Set the secret** — the exact same value as Vercel's `CRON_SECRET` env var,
   copied directly (never through a shell history-visible `export`):

       npx wrangler secret put CRON_SECRET

   Paste the value when prompted; it is not echoed.

4. **`APP_BASE_URL`** already defaults to `https://aeo.fimmick.com` in
   `wrangler.jsonc`'s `vars`, matching `lib/app-origin.ts`'s own fallback — no
   action needed unless you're deploying against a different environment, in
   which case edit that `vars` entry (or pass `--var APP_BASE_URL:...` to
   `wrangler deploy`) and commit the change if it's meant to be permanent.

5. **Deploy:**

       npx wrangler deploy

6. **Verify**, allowing up to 15 minutes for global propagation:
   - Cloudflare dashboard → Workers & Pages → `fimmick-aeo-cron-worker` →
     Triggers → Cron Events, or `npx wrangler tail` while a schedule fires.
   - Confirm each of the three schedules produces a `2xx` from its Vercel
     route. A `401` means `CRON_SECRET` doesn't match; a network error means
     `APP_BASE_URL` is wrong.

7. **Confirm Vercel actually stopped scheduling**, not just that `vercel.json` no longer
   lists any crons. Vercel's own Cron Jobs dashboard (Project → Settings → Cron Jobs) should
   show zero entries after the deploy that removed `crons` from `vercel.json` went live —
   this hasn't been independently verified to behave identically to an explicit `"crons": []`
   versus the key being entirely absent (both are used in practice, but this repo has not
   confirmed Vercel treats them the same for deprovisioning a previously-scheduled cron).
   If Vercel's dashboard still lists old cron jobs after that deploy, that's the signal the
   two forms differ here and the old jobs need manual removal there.

## Rollback

The three Vercel routes are unchanged and still accept Vercel Cron's exact request
shape, so reverting is restoring the 3-line `crons` array in `vercel.json`:

    "crons": [
      { "path": "/api/cron/pulse", "schedule": "17 4 * * 1" },
      { "path": "/api/cron/evaluate-alerts", "schedule": "47 7 * * 1" }
    ]

(`trial-emails` was never in that array historically before this branch, so
its Vercel Hobby-plan rollback would need Cloudflare kept running for it
alone, or trial-emails paused, since Hobby can't hold all 3.)

No route code needs to change either way.
