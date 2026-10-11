# Implementation notes

T01: Shared validated-evidence projection with nullable display scores. Known failed collection is failed; missing/invalid evidence is unknown; a successful page preserves the original score and explicitly limited coverage. Stored scans and saved report snapshots are unchanged. New report exports reject recorded failed collection. Browser components receive serializable display data; server-only evidence readers never enter the client bundle.

T02: shared raw-observation projection preserves partial results. Legacy expected=null; classification and mention denominators are independent. Stale rollups still suppress KPI. Completing T01 presentation audit also removed unknown /100 from brand cards. Focused 72/72 synthetic tests; typecheck/lint exit 0. Browser fixture verification deferred until the production fixture CSS build.
