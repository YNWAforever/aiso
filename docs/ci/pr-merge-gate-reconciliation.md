# PR merge-gate reconciliation

| Report area | Checkout evidence | Gate treatment |
|---|---|---|
| Tiers | lib/tier.ts exposes basic, pro, and enterprise | Test implemented mappings only |
| Roles | lib/auth.ts exposes authenticated/admin behavior; separate analyst/viewer semantics are not evidenced | Keep those report roles as a follow-up gap |
| Database | Runtime reads use Neon through lib/db.ts; migration history is under supabase/migrations | Run SQL contracts without a live database |
| Scripts | No prior typecheck or CI workflow exists | Add typecheck and pr-gate.yml |
| Operations | Weekly monitoring, staging WCAG, and live-provider canaries are outside this slice | Keep them as follow-up operational gates |

The manifest uses only checkout-evidenced roles: anonymous, authenticated, and admin. Analyst and viewer report roles remain follow-up gaps; no role-specific behavior has been inferred for them. Database service execution is tested as checked-in SQL contract text only, without a live provider or database assertion.
