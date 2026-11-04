# Project Context – SBI DNS Front-End Portal

Last updated: 03-Nov-2026

## What this project is

- **Client:** SBI (State Bank of India).
- **OEM / bidder:** F5. SBI is buying F5 BIG-IP DNS (GTM) on VELOS CX410 across DC, DR and AZ.
- **Starlight Data Solutions (us):** builds the custom **DNS Management Portal** ("front-end solution") required by RFP **Section J (J1–J5)**, as a supplier under F5. The older source docs (proposal v2.0, compliance sheet) were made under the Azalio name. Anything we send out goes as Starlight Data Solutions, with no mention of Azalio.
- **Load balancer team:** maintains SBI's load balancer. Portal VIPs, GSLB, health checks, SSL and WAF questions go to them. Outgoing docs call them "LB team".
- **Network Integrator (NI):** Bank's network partner; receives KT along with the Bank.
- The bid went to a reverse auction, and F5 has pushed hard on cost.
- **Current phase (Oct 2026):** moving into design (UI first) and collecting requirements from the client and Starlight.

## Key people (from email thread)

| Org | Name | Role |
|---|---|---|
| Azalio | Navjeet Singh | Lead on solution / clarifications |
| Azalio | Nitin | Azalio |
| F5 | Abhishek Atkari | Solutions Engineer (current SE for SBI) |
| F5 | Ganesh Borhade | Principal Account Executive |
| F5 | Tanmay Phadke | Manager, Solutions Engineering |
| F5 | Nishant Agnihotri, Harneet Singh Kalra, Shital Gandhi, Bhavya Upadhyay | F5 account team |

## Folder layout

```
F5/
├── context.md                      ← this file
├── docs/                           ← source documents (received)
│   ├── Portal specification.pdf                 RFP extract p.73–76 (H20–H24, I1–I7, J1–J5)
│   ├── SBI-DNS-Revised-Azalio-updated.xlsx      Compliance sheet, whole F5 bid (A–J)
│   ├── F5-DNS-Portal-Solution-Proposal-v2.0.docx  Azalio proposal v2.0 (17-Aug-2026)
│   ├── F5-DNS-Portal-Solution-Proposal-v2.1.docx  v2.1 (03-Nov-2026): user/access model, versioning, rollback
│   ├── F5-DNS-Portal-Solution-Proposal-v2.1-changes-highlighted.docx  same, every change in yellow
│   │       (+ .pdf of both; all four regenerated 03-Nov-2026 18:10)
│   ├── F5-DNS-Portal-Solution-Proposal-v2.2.docx  v2.2 (04-Nov-2026): new permission model, direct
│   │       Checker/Admin changes, F5 error display. LATEST.
│   ├── F5-DNS-Portal-Solution-Proposal-v2.2-changes-highlighted.docx  only v2.1 → v2.2 changes in yellow
│   │       (+ .pdf of both)
│   ├── RE_ Portal requirement for F5 DNS.eml    Email thread Nov-2025 → 29-Jul-2026
│   │       (attachment: SBI_DNS_Portal_RFP_Queries_and_F5_Confirmations.xlsx)
│   └── SBI_F5 DNS Project Plan Gantt Chart.png  20-week plan
└── analysis/                       ← our work
    ├── 01-document-review.md              What docs say, gaps, tech stack, who provides what
    ├── 02-open-questions-with-sources.md  Open questions with exact doc/page/cell references
    ├── 03-ui-screen-inventory.md          16 screens derived from requirements
    ├── 04-client-questionnaire.md         Full client questionnaire (~100 questions + 6 templates)
    ├── 05-integration-flow-lld-gaps.md    Bank-owned integration flow: our LLD per step, gaps, and the
    │                                      exact page/line of every proposal passage that must change
    ├── sbom/SBI_SBOM_DNS_Portal.docx      Bank-format SBOM (8 components). Updated 04-Nov-2026 to proposal v2.2
    │                                      (Spring Boot + React unchanged; LDAP login, permissions, versioning)
    └── starlight/
        ├── DNS_Portal_LB_Prerequisites_Starlight.xlsx  27 LB prerequisites + VIP Details + Contacts
        └── DNS_Portal_LB_Queries_Starlight.txt         20 queries for Starlight (about to be mailed)
```

## Portal requirements in one line each (RFP J1–J5)

- **J1 Functional:** web tool for all DNS tasks; MFA; user/role management; logical grouping (department/app/location); fetch + sync all records from F5; Search/List/Select/Add/Modify/Delete privileges by group; validation (duplicate, CNAME loop, TTL, name/IP); maker-checker workflow with scheduling; workflow finalised with Bank; scalable; dashboards (records per department).
- **J2 Integration:** AD; API automation of DNS changes; ITSM for change + incident.
- **J3 Security:** audit trail to SIEM; patches; non-disruptive patching; backward compatibility; **TLS 1.3+** and encryption at rest; DoS resistance; annual VAPT.
- **J4 Availability:** HA locally and across DCs; failover; **RTO 1 min, RPO 15 min**; critical patches in 72 h.
- **J5 Support:** 24x7 with SLAs; docs/training/KT; 7 years support; all licences; Bank private-cloud VMs.

## Architecture (proposal v2.0)

- Active-passive: **DC active, DR hot standby**. One portal URL via global VIP/GSLB.
- Per site: **local VIP / load balancer + Portal App/API Node 1 and Node 2** (stateless) + 2 PostgreSQL nodes. DC = primary + standby; DR = replica + standby. *A single-node-per-site variant was tried on 03-Nov-2026 and **reverted on 04-Nov-2026**; v2.1 uses the v2.0 topology.*
- Portal HA/DR Controller (site role, DB promotion, scheduler gating, readiness URL) + Infrastructure Fencing Adapter (isolates failed DC via Bank cloud API before DR promotion).
- DNS resolution stays on F5 and does not depend on the portal.
- Roles (v2.0): Requester, Approver, Admin, Auditor. **Replaced in v2.1** by the user and access model below.

## User and access model (decided 03-Nov-2026, permissions revised 04-Nov-2026) – in proposal v2.2 §5.5

Replaces the SSO (SAML/OIDC) login, AD-group roles and the bank role API. **MFA removed from scope (user decision, 03-Nov-2026).** Note: RFP J1.2 asks for MFA for all users, so this is a compliance gap that may need a deviation note to SBI/F5.

- **One Admin only.** Username and credential come from protected config (`.env` / app config, preferably injected from Vault/KMS). Stored as a salted hash, not in the DB, and not editable from the UI.
- **Local users** are created by the Admin. Passwords are stored in the portal DB as salted adaptive hashes (bcrypt/Argon2).
- **Login order:** check the local DB first (Admin + local users). **Bank LDAP/directory API is called only if the username is not in the local DB.** No MFA step.
- **First LDAP login** creates a profile (LDAP-sourced, status *Pending Access*, no groups or permissions). The Admin then maps the user to groups and permissions. Later logins of that profile still go to LDAP, because we never store Bank passwords. *(Our interpretation; to confirm.)*
- **Access levels (v2.2, 04-Nov-2026).** The Admin gives each user one level:
  - **Read only:** sees **all groups**, with no group assignment.
  - **Read + Write** (maker): sees and raises requests **only in Admin-assigned groups**. Requests need approval.
  - **Checker:** always includes Read + Write and always covers **all groups**. Approves Write users' requests, and **its own create / modify / delete runs directly after validation, with no approval**.
  - *(v2.1's "Checker for specific groups" option and "each group needs a non-Admin checker" rule are gone.)*
- Write users see **only their assigned groups' records**, enforced server-side. Read, Checker and Admin users see all groups.
- **Approval:** a Write request goes to **all Checkers + the Admin**. One approval is enough by default (multi-level is configurable). Write users can't approve.
- **Admin:** same as a Checker plus admin functions. The Admin's own changes **and rollbacks** run directly with no approval (user decision, 04-Nov-2026).
- **Direct changes** are audited as direct changes (no approver) and create a new version on success.
- **F5 errors (v2.2):**
  - Every change, including rollbacks, stores the F5 result per site (DC / DR / AZ).
  - On failure, the request is marked failed. Its page shows the F5 error code and message as returned, per site, to the maker, the Checkers and the Admin.
  - The error is kept in the audit trail and sent to SIEM. No extra plain-language hints (user chose the raw F5 message).
- **Versioning:** a record starts at v1.0. Each successfully executed change (approved Write request or direct Checker/Admin change) adds 0.1. A version is a full config snapshot plus metadata. Delete creates a "deleted" version. **Admin only:** compare versions and roll back (immediate or scheduled). A rollback creates a new version (1.3 → 1.1 creates 1.4), and history is never rewritten.

## Integration model (learned 29-Oct-2026) – replaces parts of v2.0

> **03-Nov-2026:** steps 1–2 (bank SSO + role API) and 6–7 (approval in the bank ITSM, with the bank calling our approval API) are **superseded** by the portal-side user and access model above (local DB → LDAP, Admin-mapped groups, portal checkers). What ITSM does in approval is now open (see open question 9).

The **bank provides the APIs** for SSO, MFA (if any) and the rest; the **bank provides the DNS form fields**; the **bank provides the user role**; **approval happens in the bank's ITSM**. Flow:

1. Login through the bank's SSO API (+ MFA).
2. Role from the bank's role API; user stored / updated in our DB by primary key, kept in the session.
3. Bank-defined form per config (create / modify / delete).
4. Local validation (format, duplicates and CNAME loops against the synced inventory, TTL).
5. Request saved (OPEN, request id) → ITSM ticket via the bank's ticketing API.
6. Bank admin approves in ITSM (transaction id).
7. **The bank calls our approval API** with the transaction id, yes / no and the request metadata.
8. Portal verifies the call, the request is unchanged, the approval is valid → schedule / execute.
9. Portal calls **the bank's (or F5's) change API**; result per site; ticket updated / closed; incident on failure.
10. Audit trail + SIEM.

Our LLD notes per step and the gaps found: `analysis/05-integration-flow-lld-gaps.md`. Biggest gaps: MFA "if any" vs RFP J1.2 (MFA for all); validation only client-side; role cached instead of refreshed; no state model; the inbound approval call's security (forged "yes" = unauthorised DNS change); per-site results / idempotency / unknown outcomes; ITSM update + incident missing from the LLD; record sync (J1.5) not in the flow.

## Tech stack

RHEL 9.x · Java 21 + Spring Boot · React (TypeScript) · PostgreSQL 15/16 + Patroni (Crunchy as enterprise option) · pgBackRest · NGINX OSS or F5 VIP · Bank Vault/KMS (else HashiCorp Vault) · Fluent Bit / rsyslog → SIEM · Prometheus exporters · Bank LDAP/directory API for user validation (no SSO, no MFA since 03-Nov-2026) · ITSM API.

> **Source of truth = the latest proposal, now v2.2** (v2.1 rule from the user on 04-Nov-2026; v2.2 has the same stack). The stack is what the proposal says: **Java/Spring Boot + React**. Other mentions are **not decisions**: NestJS/Next.js in `dns-portal/docs` (the user's own generated drafts) and "Python FastAPI" in the F5 API mail draft. Don't change the stack anywhere without asking.

## Bank answers (04-Nov-2026) – inputs for local development
- **Directory:** it's **LDAP** (LDAPS bind). Base DN, filter, service account and test users are still to be asked.
- **F5 UAT (BIG-IP VE) access:** comes **after** F5 shares the API docs.
- **ITSM:** **on hold**; the Bank will update. Build behind a feature flag with a mock.
- **Sample DNS data:** the user will try to provide it.
- **Groups:** no Bank list is needed; the Admin creates groups in the portal.
- **DNS form rules:** to be asked together with the F5 API docs.
- **SIEM log format:** to ask the Bank.
- **F5 API documentation request:** mailed. The list of items still missing from it is in the 04-Nov chat (ZoneRunner/standard records incl. PTR, sync-group behaviour, transactions, save-config, BIG-IQ vs BIG-IP, VELOS F5OS health, API user role, TLS, limits, version).

## Decisions made so far

- **UI branding:** use the **F5 logo** for now; SBI branding to be confirmed (questionnaire P1).
- LB prerequisites and queries are prepared by Starlight Data Solutions for the LB team. There is no Owner column, and the remarks column is "LB Team Remarks".
- Deliverables are kept as local files in this folder.

## Biggest open questions (block design)

1. **BIG-IQ CM or direct BIG-IP** – how the portal talks to F5. Not decided; proposal says "BIG-IP/BIG-IQ" = whichever F5 confirms.
2. **Object scope** – DNS records only, or also Wide IPs, pools, monitors, topology, zones? Azalio estimated records only; RFP J1.1 says "all front-end DNS management tasks".
3. **RTO 1 min** – one server failing, or whole DC lost? v2.0 assumes whole-DC loss (full DR stack). Ask for two separate RTOs.
4. **TLS** – RFP now says TLS 1.3+; F5 compliance sheet (J3.5 = N) says its management API supports only TLS 1.2. Deviation request to SBI is open.
5. **ITSM** – product (hint: BMC) and depth (store ticket no. → check approval → update ticket → raise incident → create ticket).
6. **Sizing** – compliance E1 says F5 must support 500 zones × 1 lakh records (max 5 crore). Actual SBI counts unknown.

7. **Bank API specs** – **LDAP/directory API** for user validation (LDAP bind or REST? service account? which attributes come back?), ITSM ticket + approval call (auth, payload, polling fallback), change API (**F5's own API or a bank middleware?** one call for all sites or per site? read / list API for sync?).
8. **DNS form fields** – the bank's list per record type and operation, with validation rules and lookup lists.
9. **Maker-checker** – *decided 03-Nov-2026, revised 04-Nov-2026:* portal-side checkers. All Checkers cover all groups, plus the Admin. Checker and Admin changes need no approval. Still open: does an ITSM change approval **also** gate execution, or does ITSM only get the ticket and status updates?

All 12 SBI queries and 12 F5 internal confirmations in the 29-Jul-2026 workbook are still **Open**; no replies recorded in the documents.

## Known document issues

- Proposal still cites old **K1–K5** numbering; RFP now uses **J1–J5**.
- Proposal says "TLS 1.3"; compliance sheet says TLS 1.2 max (contradiction).
- Compliance sheet is missing **J4.3** (RTO/RPO) and **J4.4** (72-h patching).
- Proposal Figure 1 is the old single-site diagram; Vault/KMS shown only at DC.
- Proposal recommends a quorum/witness but sizes none.
- Proposal v2.0's identity (SAML/OIDC, "never handles passwords"), approval (in-portal Approver, Figure 4), execution (direct F5) and assumptions / RACI no longer match the bank-owned integration model – page / line of every passage in `analysis/05-integration-flow-lld-gaps.md` §3.
- **v2.1 (03-Nov-2026)** fixes the identity and role text throughout (no SSO/IdP/SAML/OIDC wording left) and adds §5.5. Diagram topology is as in v2.0 (local VIP/LB + Node 1/Node 2 at DC and DR). The SSO/IdP/MFA labels in Figures 1–4 were replaced with local login + LDAP wording, and the Fig 3 legend no longer lists MFA. **The text and diagrams have no MFA/SSO/IdP wording left (verified).** Figures still say Requester/Approver/Admin (mapped to Write/Checker/Admin on page 8). Still open in v2.1: **partly de-branded** to match the user's PDF (`Downloads\F5-DNS-Portal-Solution document.pdf`): cover "Prepared by", Author column, footer text and header logo removed. The Exec Summary opening is now generic ("The proposed solution is a custom DNS Management Portal…"). **Azalio** still appears in 2 body places (Assumptions "Failover control and fencing" row; RACI column header, which repeats across pages), and must still be changed to Starlight Data Solutions or neutral wording; it still cites K1–K5 rather than J1–J5.

- **v2.2 (04-Nov-2026)** is built on v2.1, with the same topology, de-branding and figures. It changes only §5.5 (permissions, group assignment, approval flow, new "Direct Changes by Checkers and the Admin" and "Execution Result and F5 Error Reporting", permission matrix, versioning / rollback wording), the scope bullet, logical-architecture text, application/data-layer bullets, governance bullets, the workflow execution paragraph and revision row 2.2. Figure 4 still shows only the maker → approval path; the direct Checker/Admin path isn't drawn. Same open items as v2.1 (2× Azalio, K1–K5).
- **RFP check (04-Nov-2026):** versioning, compare and rollback are **not** in the RFP (J1–J5) or v2.0. They're our addition, justified under J1.8 ("not limited to") and J1.9 (workflow additions agreed with the Bank). Direct Checker/Admin changes without approval also go beyond the RFP's maker-checker wording (J1.8).

## Gantt (20 weeks, start date not fixed)

Planning W1–W4 · Design W3–W7 (sign-off end W6) · Build/Integration W6–W14 · Test/UAT W13–W19 · Cutover W19 · Go-live W20.

## Next steps

- [ ] Mail Starlight the prerequisites sheet + queries file (in `analysis/starlight/`).
- [ ] Review "Our proposal" defaults in `04-client-questionnaire.md`, then send to SBI (via F5).
- [ ] Get answers on the 6 blocking questions above.
- [ ] Start UI design from `03-ui-screen-inventory.md` (records-only scope, F5 logo, large-volume inventory).
- [ ] Ask the bank for the API specs and the form fields (open questions 7–9).
- [ ] Close the LLD gaps in `05-integration-flow-lld-gaps.md` (state model, approval-call contract + security, per-site execution).
- [ ] Revise the proposal to v2.1 at the places listed in `05` §3 (outgoing as Starlight Data Solutions). *Partly done 03-Nov-2026:* the user/access model, versioning and rollback are in v2.1. Remaining: diagrams, Azalio → Starlight rebrand, K → J numbering, and the other `05` §3 items (ITSM / execution path).
- [ ] Confirm with the client: LDAP-sourced users are re-validated against LDAP on every login; one checker approval is enough by default; the Bank accepts Checker / Admin changes without a second approval (J1.8 maker-checker).
