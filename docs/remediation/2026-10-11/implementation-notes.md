# Implementation notes

T01: Shared validated-evidence projection with nullable display scores. Known failed collection is failed; missing/invalid evidence is unknown; a successful page preserves the original score and explicitly limited coverage. Stored scans and saved report snapshots are unchanged. New report exports reject recorded failed collection. Browser components receive serializable display data; server-only evidence readers never enter the client bundle.
