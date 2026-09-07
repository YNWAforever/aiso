# Legal publication review — unresolved inputs

These are review instructions, not public copy. All four accompanying documents are unpublished proposals. They do not establish current compliance, a service commitment or an accepted agreement. No privacy/terms route, navigation availability or sitemap entry is authorised by this work.

## Required approvals and evidence

1. **Operator and contacts:** confirm the exact contracting/data-using legal entity, business or registered address, service/billing/privacy/security contacts, and who can fulfil access and correction requests. AISO branding does not establish a legal operator. Do not substitute a developer's or provider's address.
2. **Collection notices:** approve a PICS at each collection point (account/signup, submitted URL, client onboarding, billing and any contact form). Identify mandatory versus voluntary fields, purpose, consequences of omission, recipient classes and request contact. A general policy alone is insufficient. No new contact form is implemented.
3. **Data and recipients:** verify live hosting/database/auth/payment/email/AI providers, subprocessors, optional n8n/client webhooks, exact transmitted fields, provider retention/training terms and processing countries. Source references to Neon, Stripe, Resend and OpenRouter are not proof of current deployment settings or signed processor safeguards. Approve the provider/location notice before replacing its placeholder.
4. **Cookies and marketing:** inventory actual cookie/storage names, durations, purposes and optional analytics; confirm consent controls and direct-marketing practices. The draft's notice/consent language is a proposed obligation, not proof that a consent mechanism exists.
5. **Retention and deletion:** approve a category-specific schedule and operational deletion workflow covering anonymous/owned scans, legacy details, evidence, Pulse answers, reports, leads, billing records, logs, backups and provider copies. Evidence v1 inherits scan lifecycle. No automatic deletion TTL is configured or claimed. Review whether existing retention meets necessity requirements; an inherited lifecycle alone does not establish compliance.
6. **Access and security:** verify tenant boundaries, public summaries, signed-report sharing/revocation, identity checks for requests, incident escalation and supplier safeguards. Do not promise confidentiality of already shared copies, certify compliance, or imply that all data remains in Hong Kong.
7. **Scan-specific accuracy:** v1 origin-only URL descriptors and zero raw excerpts apply only to the new evidence attachment. Other stored check details, AI outputs or monitoring records may contain content or URLs. Approve wording against the final implementation; do not claim global redaction.
8. **Commercial terms:** verify plan/checkout disclosures, taxes, billing currency, renewal, cancellation, refunds, trials, service-change notice and account-closure/export procedures. The draft introduces no new refund exclusion, payment deadline, SLA or liability cap. Decide whether separate B2B negotiated terms are needed.
9. **Law, forum and users:** counsel must select governing law and dispute forum, assess intended customer locations and any consumer protections, decide eligibility/minor policy, approve liability allocation and content licence, and reconcile negotiated agreements. Hong Kong privacy references do not choose the contract's governing law.
10. **Acceptance and translation:** choose the acceptance record/process, effective date, material-change process and any language-precedence rule. Arrange legal and native-language review of both versions. Do not publish unresolved bracketed fields.

## Primary Hong Kong privacy sources

Checked on 5 September 2026. These sources inform the review checklist and proposed privacy structure; they are not a legal opinion on AISO.

- [PCPD: Six Data Protection Principles](https://www.pcpd.org.hk/english/data_privacy_law/6_data_protection_principles/principles.html): framework for purpose, use, retention, security, transparency and individual access/correction. The Ordinance controls if explanatory material differs.
- [PCPD: Guidance on Preparing Personal Information Collection Statement and Privacy Policy Statement](https://www.pcpd.org.hk/misc/dpoc/files/pics_and_pps.pdf): distinguish a collection-point notice from a general policy, and identify purpose, recipient classes and contact information.
- [PCPD: Privacy Policy Statement](https://www.pcpd.org.hk/english/about_pcpd/privacy_policy_statement/privacy_policy_statement.html): illustrates provision of collection notices on or before collection and a named access/correction contact. Its own provider arrangements and retention practices must not be copied as AISO facts.

## Source-to-product review anchors

- `app/api/scan/route.ts`: origin normalisation, check storage, owned versus anonymous scans and optional outbound workflows.
- `lib/result-access.ts` and `app/[lang]/result/[id]/page.tsx`: public summary and account-only full result.
- `docs/superpowers/specs/2026-09-05-c4-c6-public-pages-evidence-design.md`: approved local evidence limits and inherited scan retention.
- `CLAUDE.md`, `.env.example`: provider capabilities and configuration references; do not read secret values into this review.
- Runtime commercial catalogue and accepted orders remain authoritative for prices and entitlements; the drafts intentionally do not duplicate numeric offers.

## Release gate

Obtain operator/product/privacy/legal sign-off, fill all required notices and contacts, verify operational commitments, and approve both final language versions before any legal route is made available. Keep these drafts out of the public page catalogue until that separate approval.
