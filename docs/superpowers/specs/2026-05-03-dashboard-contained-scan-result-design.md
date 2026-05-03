# Dashboard-Contained Scan & Result Flow — Design Spec

## Overview

Move the scan form and result viewing into the dashboard so logged-in users never need to leave. The public homepage scanner and public result page continue working for anonymous users. Scans initiated from the dashboard automatically link to the client. Past results link directly to the dashboard result page instead of the public one.

---

## Changes

### 1. Inline Scan Form in ScanStep

Replace the "Open scanner →" link-to-homepage button with a self-contained scan form:

- URL input field + optional industry dropdown + optional region dropdown
- "Run Scan" button that POSTs to `/api/scan` with `clientId` automatically
- On success (200), redirect to `?step=results&scanId=<new_scan_id>`
- On error, show inline error message
- "Scanning..." loading state while the request is in flight
- Scan history stays below the form as before

**Reuses** the same `/api/scan` endpoint — no changes to the scan engine.

### 2. Dashboard Result Page

New route: `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`

- Uses the dashboard layout (sidebar + dark/light theme via tokens)
- Fetches the scan from Supabase, scoped to the logged-in account
- Renders the same result content as `app/[lang]/result/[id]` but themed with dashboard tokens (`bg-dash-surface`, `text-dash-text`, etc.)
- No `SaveScanButton` — scans from dashboard are already linked to the client
- Back link to `?step=results` (the wizard Results step)
- "Improve →" button navigates to `?step=improve` with agent analysis
- "View Full History" link to `?step=scan` (shows past scans)

### 3. Context-Aware Scan Links

**RecentScans** component: Add optional `clientId` prop.
- When `clientId` present: link to `/dashboard/[clientId]/result/[scanId]`
- When absent: link to `/result/[scanId]` (public page, unchanged)

**ScanStep history list**: Links already render inside the dashboard. Update them to use `{`/${lang}/dashboard/${clientId}?step=results&scanId=${id}`}` instead of the old result path.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Scan API error | Show inline error message in the form |
| Scan fetch fails (dashboard result) | Show "Scan not found" message |
| Unauthorized (wrong account) | Show "Scan not found" (don't leak existence) |
| Scan still running (agent_status = pending) | Show results, "Agent analysis pending" label |

---

## File Plan

| File | Action | Purpose |
|---|---|---|
| `components/dashboard/ScanStep.tsx` | Modify | Replace link with inline scan form |
| `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx` | Create | Dashboard result page |
| `components/dashboard/RecentScans.tsx` | Modify | Add `clientId` prop for context-aware linking |
| `app/[lang]/dashboard/[clientId]/page.tsx` | Modify | Update scan history links, add result routing |
| `app/api/scan/route.ts` | Review | Ensure clientId auto-link works (already supports it) |
