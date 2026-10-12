# T33/T36 / UC75 — private work workflow

Four desktop/mobile EN/zh-HK cases passed with compiled existing WorkspaceHome, ObservationWorkspace, GroupedOpportunityCards and DraftEditor. The home CTA opens incomplete observations. Original raw text remains readable; null classification never becomes brand absent. The test then navigates the existing opportunity route, without inventing a new product link, and verifies every frozen source reference. Only supported existing opportunity IDs are sent; the unknown observation is excluded. One synthetic POST saves a private draft, which remains discoverable and can be reopened after returning to the opportunity page. No publish/delivery/retest/provider request occurs.

This is a component/HTTP fixture workflow, not authenticated route or database acceptance. The first four failures were an undefined test copy key, not a product defect; using the existing draftOnly message fixes the test contract. Failure JSON/screenshots/traces remain private. Final report T36-uc75-final.json:4 pass,0 fail/skip/flaky. Local SQL persistence evidence is separate T34. The generated home fixture binds its client ID before projecting the actual primary CTA; no rendered hyperlink is patched.

Rollback: test/fixture revert only; no production change.
