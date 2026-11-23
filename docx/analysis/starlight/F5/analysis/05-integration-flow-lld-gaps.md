# SBI DNS Portal – Integration Flow, LLD Notes and Gaps

Last updated: 29-Oct-2026

## What changed (learned 29-Oct-2026)

- **The bank provides the APIs** for SSO, MFA (if any) and everything else the portal integrates with.
- **The bank provides the fields** each DNS config needs (the request form).
- **The bank provides the user role.**
- **Approval happens in the bank's ITSM**: the portal raises the ticket, the bank admin approves there, the bank calls **our** API with the decision, then the portal calls **the bank's** API for the change.

Proposal v2.0 assumed the opposite on most of these: SAML/OIDC redirect with AD group claims mapped to our own roles, an in-portal Approver, ITSM only as a side record, and direct F5 API calls. See section 3 for exactly where it must change.

## 1. The flow with our LLD notes and the gaps

Each step: the step, **our LLD** (as written by the team), then the gaps to close.

### Step 1 – Login through the bank's SSO API (and MFA, if any)
**LLD:** Normal API hitting and validating response.

Gaps:
- Define "validating": token signature / issuer / audience / expiry, or the user-id and status fields of a plain answer. An HTTP 200 alone is not enough.
- **MFA "if any" contradicts RFP J1.2 ("enforce MFA for all users").** Refuse login when the bank answers without MFA, or get the bank to confirm MFA is always part of its SSO.
- If the password / OTP passes through the portal: never store or log it, TLS 1.3 only.
- Session: server-side, secure / HttpOnly / SameSite cookie, idle + absolute timeout, logout; shared by all nodes and the DR site (app nodes are stateless).
- Timeouts, bank API down, repeated failures; rate limiting (J3.6). Bank API reachable from DR.
- Portal's own credentials for the bank API in Vault. Login success / failure → audit + SIEM.

### Step 2 – Fetch the user's role from the bank's role API (or use the role we hold)
**LLD:** We check for user info by primary key; if not present we store it in our DB; if present we save the info in the session.

Gaps:
- Which key: bank employee id, AD account name, …?
- **Fetch the role from the bank at every login and overwrite the local copy** ("if present, save in session" keeps a role the bank removed).
- Role API down → deny (fail closed), not the cached role. Decide whether read-only is acceptable.
- **Bank role → privileges:** RFP J1.6 needs per-operation privileges (search, list, select, add, modify, delete) per logical group; J1.8 needs separately managed maker-checker groups. Define the mapping and who maintains it.
- User removed at the bank → disabled locally; role re-checked before sensitive actions, not only at login.
- Store only the personal data needed; audit role changes.

### Step 3 – The user fills in the bank-defined form for each config (create, delete, modify)
**LLD:** UI checks and field management.

Gaps:
- Field list as **configuration**: per record type (A, AAAA, CNAME, MX, TXT, SRV, PTR, …) and per operation; type, mandatory, allowed values, default, validation rule; versioned; editable by an admin without a release.
- Modify / delete start from the **synced inventory**: pick the record, form pre-filled, request stores old → new.
- Logical-group fields (department, application, location) come from lookup lists: bank API or static?
- The **server** checks the user may act on that record's logical group.
- Open: several records in one request (bulk)? Drafts?

### Step 4 – The portal validates locally (format, duplicates and CNAME loops against the synced inventory, TTL)
**LLD:** Required clarity for fields; pre-form validation checks will be performed on the client side.

Gaps:
- **Client-side only is a security gap** (bypassable, VA/PT finding). **Every check runs on the server too**; client checks are for convenience.
- Duplicate and CNAME-loop checks need the inventory, so they are server-side anyway.
- Conflicts with other open requests on the same record.
- Zone exists and belongs to the user's logical group.
- TTL limits from the bank's rules.
- Dependency: the bank's field list and rules ("required clarity for fields").

### Step 5 – Save the request and create the ITSM ticket (the bank's ticketing API)
**LLD:** Request in OPEN state with a request id, and the bank's internal tool API is called for admin approval.

Gaps:
- Full **state model**, e.g. OPEN → PENDING_APPROVAL → APPROVED / REJECTED / EXPIRED → SCHEDULED → EXECUTING → SUCCESS / FAILED / PARTIAL, plus CANCELLED; who may make each transition.
- ITSM call fails / times out → retry with an idempotency key (never two tickets); state ITSM_FAILED; tell the user.
- Store together: our request id, the bank's transaction id, the ITSM ticket id.
- Define the ticket content (requester, records old / new, sites, schedule, justification).
- **Hash of the request** stored at submission (step 8 checks it); request locked: an edit = cancel + new ticket.
- Requester cancels → portal cancels the ticket.

### Step 6 – The bank admin approves in ITSM
**LLD:** It has a request or transaction id; the order is pushed into the cache and the DB session.

Gaps:
- This runs in the bank's ITSM; the portal only waits. Clarify "pushed into cache and DB session".
- The proposal has **no cache** component: the **DB is the source of truth**; a cache is optional and must survive node loss and the DR switchover.
- Admin never acts → approval timeout (request expires), reminders.
- Rejection → closed, requester notified.
- Maker-checker: the ITSM approver must not be the requester (check the approver identity in the callback).

### Step 7 – ITSM calls our approval API
**LLD:** The bank calls our endpoint with the transaction id, a yes or no, and the request's metadata.

Gaps:
- **Top risk: a forged "yes" = an unauthorised DNS change.** Mutual TLS or OAuth client credentials, IP allowlist, ideally a signed payload.
- Written contract: transaction id, decision, approver id, approval time, change window, metadata; error answers (unknown id, already decided).
- Duplicate calls ignored safely; a "no" after a "yes" handled.
- Answer fast (HTTP 202), process in the background.
- Call never arrives → poll ITSM for the status.
- Callback URL = the global portal address (works after a DR switchover).

### Step 8 – Verify the call, check the request has not changed and the approval is still valid, then schedule or execute
**LLD:** Request processing, logged in the user's log and our logger.

Gaps – the checks, spelled out:
- The call is authentic (step 7).
- **Re-read the ticket from ITSM**; never trust the callback's metadata alone.
- Request hash = the one stored at submission.
- Approval still valid; approver ≠ requester and holds the approver role.
- **Re-validate the records against the current inventory.**
- Inside the change window / schedule.
- Only the active site's scheduler executes (proposal already has this).
- "Logs in user" = the request's audit history + structured application logs, no secrets.

### Step 9 – Call the bank's (or F5's) change API, record the result per site, update / close the ticket, raise an incident on failure
**LLD:** The bank's API is called and the response processed; on success the order is SUCCESS with the response logged in the DB; on failure FAILED with the reason and response in the DB.

Gaps:
- Results **per site** (DC / DR / AZ) → a PARTIAL state; define retry of the failed site, rollback, or a person.
- **Idempotency key** on the change call (a retry after a timeout must not apply it twice).
- Timeout = unknown outcome → read the record back before deciding (in-flight reconciliation).
- Retry transient errors only, with backoff and a limit.
- Post-change check (inventory or DNS lookup), then update the inventory.
- **Update / close the ITSM ticket, raise an incident on failure** (RFP J2.3) – missing from the LLD. Notify the requester.
- Mask sensitive data in stored responses.

### Step 10 – Everything goes to the audit trail and SIEM
**LLD:** none yet.

Gaps:
- Event list: login success / failure, role changes; request created / cancelled / validated; ITSM ticket created, approval call received / rejected, verification failures; execution per site; admin changes to field lists, roles, groups.
- Append-only audit table (optionally hash-chained), **7 years**, reflected in DB sizing.
- SIEM format (JSON / syslog / CEF) via Fluent Bit; NTP.
- One correlation id across request, transaction, ticket and change calls.
- Never log passwords, OTPs, tokens or bank API credentials.

## 2. Gaps across the whole flow

1. **Record sync (RFP J1.5)** is not in the flow, yet steps 3, 4, 8 and 9 depend on it: periodic read from the bank's / F5's list API + detection of changes made directly on F5.
2. **Scheduling (J1.8):** who sets the execution time – the requester in the form or the ITSM change window?
3. **Notifications** to requester and approver.
4. Timeouts, retries and down-behaviour for every bank API (SSO, MFA, roles, ITSM, change).
5. **Admin screens** for the field lists, role → privilege mapping, logical groups (J1.3).
6. Requests and approval calls caught in a DR switchover continue safely.

## 3. Where proposal v2.0 must change

Page and line as Word lays out `docs/F5-DNS-Portal-Solution-Proposal-v2.0.docx` (18 pages; line = line on that page). Lines inside tables are counted per cell, so table rows are given by name.

### 3.1 Identity – SAML/OIDC redirect and "never handles passwords"
| Page / line | Section | Text now | Change |
|---|---|---|---|
| p.4 l.8 | 1 Executive Summary | "Integrates with Bank's AD/IdP and MFA, SIEM, and ITSM." | → the bank's SSO / MFA / role APIs |
| p.5 l.13 | 3.1 In Scope | "AD/IdP and MFA (Single Sign-On)." | → integration with the bank's SSO, MFA and role APIs |
| p.7 l.31 | 5.1 High-Level System View | "The Bank's IdP/AD with MFA for SSO and central authentication." | → bank SSO / MFA APIs |
| p.8 l.16 | 5.2 Logical Architecture | "A DNS request is authenticated through Bank AD/IdP with MFA, validated and subjected to role-based maker-checker workflow…" | authentication via bank APIs; approval via ITSM |
| p.9 l.4–6 | 5.2.1 Presentation Layer | "Handles SSO redirection to the Bank's IdP: … redirect to the IdP for login and MFA … redirected back to the portal with a token." | rewrite for the bank's API login (or keep only if the bank's API is standard OIDC) |
| p.9 l.18 | 5.2.2 Application Layer | "Implement RBAC based on AD group claims." | → RBAC from the bank's role API + our privilege mapping |
| p.10 l.39–43 | 5.2.4 Integration Layer – "IdP and AD with MFA" | "The portal uses SAML or OIDC to: Redirect users… Enforce MFA at the IdP level. Receive user identity and AD group information in the token. The portal then maps these groups into the internal role model…" | rewrite the whole block |
| p.11 l.13 | 5.3 Architecture Traceability – Security and MFA | "SSO and MFA are enforced by the IdP/AD, with the portal trusting only validated tokens." | → enforced through the bank's APIs |
| **p.11 l.14** | 5.3 – Security and MFA | **"The Portal App nodes never store or manage local passwords, they operate entirely on trusted IdP-issued identities."** | **remove or reword** if credentials pass through the portal: "credentials are passed to the bank's API over TLS and never stored or logged" |
| p.13 l.11–12 | 5.4 Workflow Diagram text | "Handles SSO redirects to the Bank's IdP/AD with MFA." / "After successful authentication and MFA at the IdP…" | → bank API login |
| Figures 1 (p.6), 3 (p.8), 4 (p.13) | | "SSO Redirect" box; "Redirect to IdP for SSO and MFA" | redraw |

### 3.2 Approval – the in-portal Approver and Figure 4 become ITSM approval + callback
| Page / line | Section | Text now | Change |
|---|---|---|---|
| p.5 l.17 | 3.1 In Scope | "ITSM integration for change and incident management, including ticket correlation, status validation/workflow gating where applicable…" | → ITSM is the approval step (ticket raised by the portal, decision returned by the bank's call) |
| p.7 l.16 | 5.1 | "Bank users (DNS Requesters, DNS Approvers, DNS Admins)…" | approvers act in ITSM |
| p.7 l.30 | 5.1 | "The Bank's ITSM tool for change and incident correlation." | → change approval, then correlation |
| p.8 l.24 | 5.2.1 Users | "Represented in the diagram as "DNS Requester", "DNS Approver", and "DNS Admin"." | Approver = bank admin in ITSM |
| p.9 l.19 | 5.2.2 | "Enforce maker–checker workflows for DNS changes." | maker = portal requester, checker = ITSM approver |
| p.10 l.43 | 5.2.4 | "…internal role model (requester, approver, admin, auditor)." | roles from the bank |
| p.11 l.3–6 | 5.2.4 ITSM Tool | "The portal integrates with the Bank-provided ITSM APIs to: Create or link change records… Validate applicable approval/status conditions before execution…" | → raise ticket, receive approval call, re-verify, update / close, incident on failure |
| p.11 l.20–21 | 5.3 Governance and Maker–Checker | "Role-based control over who can request and who can approve." / "Enforcement that requesters cannot approve their own changes" | → enforced on the ITSM approver identity in the callback |
| p.13 l.7 | 5.4 | "Users (Requesters, Approvers, Admins) open the DNS Portal URL…" | approvers do not need the portal |
| p.13 l.20 | 5.4 | "On demand, calls the ITSM Tool APIs to create or update change tickets." | → always: ticket raised at submission |
| **p.13 (Figure 4, caption l.3)** | 5.4 Workflow Diagram | Sequence: Requester → Portal → **Approver** views / approves in the portal → scheduler → F5 | **redraw:** Portal → ITSM (create ticket) → bank admin approves in ITSM → **ITSM → Portal approval API** → verify → bank change API → ITSM update |

### 3.3 New items – the inbound approval API and its security
Nothing exists yet; add:
| Where | Add |
|---|---|
| p.9 l.23, 5.2.2 ("Expose REST APIs for UI and possible future automation.") | The inbound **approval API** for the bank's ITSM. |
| p.11, 5.2.4 ITSM Tool (after l.6) | The callback contract (transaction id, decision, approver, time, window), polling fallback. |
| p.11, 5.3 Security and MFA (after l.14) | Callback security: mutual TLS / OAuth client credentials, IP allowlist, signed payload, re-read of the ticket from ITSM, request hash, idempotency, approval expiry. |

### 3.4 Execution – bank API instead of F5 direct (only if the bank confirms)
| Page / line | Section | Text now |
|---|---|---|
| p.4 l.14 | 1 Executive Summary | "…integrates with the F5 DNS environment through F5-supported management APIs/interfaces…" |
| p.4 l.40 | 2.2 Objectives | "Automate DNS changes across F5 DC/DR/AZ using APIs, ensuring consistency." |
| p.5 l.14 | 3.1 In Scope | "Integration with the F5 DNS environment through F5-supported management APIs/interfaces…" |
| p.7 l.29 | 5.1 | "F5 BIG-IP DNS devices at DC/DR/AZ to perform DNS record automation via APIs." |
| p.9 l.22 | 5.2.2 | "Orchestrate DNS change execution across F5 DC/DR through F5-supported management APIs/interfaces." |
| p.10 l.32–34 | 5.2.4 F5 DNS Infrastructure | "For each approved change, the Portal App calls: F5 DC… F5 DR and F5 AZ…" |
| p.12 l.35–37 | 5.3 Multi-Site DNS Control | "The portal connects through the F5-supported management interfaces…" / "A single approved change… automatically applied to F5 at all sites…" |
| p.13 l.21 | 5.4 | "When a DNS change request is approved and ready to execute, the active portal site calls the appropriate F5 DNS management interfaces…" |
| p.17 l.1 | 7 Assumptions – "F5 API boundary" | "F5 confirms the supported BIG-IP/BIG-IQ management API/interface…" |
| p.18, 8 RACI – row "F5 management API documentation, access and supported object mapping" | | Bank A/R if the change API is the bank's |

### 3.5 Assumptions and RACI – bank API specs and test environments
| Where | Text now | Change |
|---|---|---|
| p.16 l.41, 7 Assumptions – "Enterprise services" | "AD/IdP/MFA, ITSM, SIEM, PKI and Bank-standard Vault/KMS/backup services are provided as reachable enterprise integration endpoints…" | Add: the bank provides the **specifications, test environments and service credentials** for the SSO, MFA, role, ITSM (ticket + approval call) and change APIs, and the **DNS form field definitions**. |
| p.18, 8 RACI – row "AD/IdP/MFA, ITSM, SIEM and PKI endpoint availability" | Bank A/R | Add rows, Bank A/R: bank API specifications and sandboxes (SSO / MFA / role / ITSM / change); DNS form field definitions and validation rules; ITSM approval workflow and the call to the portal. |

Also still open from before: the proposal cites **K1–K5**, the RFP uses **J1–J5** (p.5–6, section 3/4).
