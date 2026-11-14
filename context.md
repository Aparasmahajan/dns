# Project Context – SBI DNS Front-End Portal

Last updated: 14-Nov-2026 (full refresh 06-Nov; decisions to 09-Nov; 13-Nov mail pack, timeline and SBOM rebuild added)

## 1. What this project is

- **Client:** SBI (State Bank of India).
- **OEM / bidder:** F5. SBI is buying F5 BIG-IP DNS (GTM) on VELOS CX410 across DC, DR and AZ.
- **Starlight Data Solutions (us):** builds, delivers and supports the custom **DNS Management Portal** ("front-end solution") required by RFP **Section J (J1–J5)**, as a supplier under F5.
  - The older source docs (proposal v2.0, compliance sheet, email thread) were made under the Azalio name.
  - **Anything we send out goes as Starlight Data Solutions, with no mention of Azalio**, including hidden places such as docx style names and document properties.
- **LB team:** maintains the Bank's load balancers (portal VIPs, GSLB, health checks, TLS, WAF). Outgoing docs call them "LB team". On 27-Oct the user said Starlight maintains the LB.
- **Network Integrator (NI):** the Bank's network partner; receives knowledge transfer along with the Bank.
- The bid went to a reverse auction, and F5 has pushed hard on cost.
- **Current phase (13/14-Nov-2026):**
  - Requirements are at internal v1.2, issued externally on 13-Nov as **v1.0** (see §4).
  - The first build increment of the portal runs locally in Docker, with **F5 mocked**. The Auditor level was added on 09-Nov.
  - A status mail with the requirements, proposal, development timeline and SBOM was drafted on 13-Nov (`mail 13 Nov 2026/`).
  - Next is the real F5 API integration. It waits for the F5 API documentation, the supported way to manage A/AAAA/PTR records, and a test F5 GTM (needed by 2-Dec per the timeline).

## 2. Key people (from email thread)

| Org | Name | Role |
|---|---|---|
| (Azalio in the thread) | Navjeet Singh | Lead on solution / clarifications |
| (Azalio in the thread) | Nitin | – |
| F5 | Abhishek Atkari | Solutions Engineer (current SE for SBI) |
| F5 | Ganesh Borhade | Principal Account Executive |
| F5 | Tanmay Phadke | Manager, Solutions Engineering |
| F5 | Nishant Agnihotri, Harneet Singh Kalra, Shital Gandhi, Bhavya Upadhyay | F5 account team |

The last email in the thread is dated 29-Jul-2026; there has been nothing newer since.

## 3. Folder layout (as on disk, 14-Nov-2026)

The whole `F5/` folder is a **git repo** (4 commits, 05-Nov; everything added since 05-Nov is **not committed** yet, in this repo and in `portal/`). `.gitignore` keeps out secrets (`.env`), `node_modules`, build output and Office lock files.

```
F5/
├── context.md                ← this file (master project notes)
├── requiments.md             Draft request to F5 for API documentation (items A–G, 28 points).
│                             ⚠ Still says "Python FastAPI" backend → fix to Java/Spring Boot before sending.
├── docs/                     Source documents
│   ├── Portal specification.pdf                   RFP extract p.73–76 (H20–H24, I1–I7, J1–J5)
│   ├── SBI-DNS-Revised-Azalio-updated.xlsx        Compliance sheet, whole F5 bid (A–J)
│   ├── RE_ Portal requirement for F5 DNS.eml      Email thread Nov-2025 → 29-Jul-2026
│   │       (attachment: SBI_DNS_Portal_RFP_Queries_and_F5_Confirmations.xlsx)
│   ├── SBI_F5 DNS Project Plan Gantt Chart.png    20-week plan
│   ├── F5-DNS-Portal-Solution-Proposal-v2.0.docx  17-Aug-2026 (Azalio-branded original)
│   ├── …-v2.1(.docx/.pdf, + changes-highlighted)  03-Nov-2026 (files regenerated 04-Nov 11:28)
│   │       ("- Copy.docx" files = older 03-Nov drafts)
│   ├── …-v2.2(.docx/.pdf, + changes-highlighted)  04-Nov-2026 ← AGREED BASELINE (internal number; still has Azalio)
│   ├── F5-DNS-Portal-Requirements-v1.2(.docx/.pdf) 09-Nov-2026 ← CURRENT REQUIREMENTS (internal number): v1.1 +
│   │       Auditor level and the 09-Nov decisions, open point B15
│   ├── F5-DNS-Portal-Requirements-v1.1(.docx/.pdf) 06-Nov-2026: v1.0 + new §14 UAT requirements; Decision log → §15,
│   │       Open points → §16 (new B11–B14)
│   ├── F5-DNS-Portal-Requirements-v1.0(.docx/.pdf) 05-Nov-2026 (old internal v1.0; NOT the v1.0 issued on 13-Nov)
│   └── F5-DNS-Portal-Requirements-v0.1 / v0.2     INTERNAL drafts that show build status: do NOT share
├── mail 13 Nov 2026/         OUTGOING PACK of 13-Nov (Azalio-free, externally numbered, see §4):
│   ├── F5-DNS-Portal-Solution-Proposal-v2.1(.docx/.pdf)   = internal v2.2, de-branded, dated 13-Nov-2026
│   ├── F5-DNS-Portal-Requirements-v1.0(.docx/.pdf)        = internal v1.2, dated 13-Nov-2026
│   ├── F5-DNS-Portal-Development-Timeline-v1.0(.docx/.pdf) 16-Nov → 31-Dec plan, F5-dependent steps in red
│   ├── SBI_SBOM_DNS_Portal(.docx/.pdf)                    SBOM rebuilt with the real dev-build versions (21 pages)
│   └── mail-13-Nov-2026.html                              status mail (copy into Outlook to keep the red highlights)
├── portal/                   The working portal (git submodule, Docker). Remote: github.com/paras-azalio/dns.git
│                             ⚠ the GitHub account name contains "azalio". Code guide in portal/arch/ (16 docs, 10-Nov)
├── static-portal/            Browser-only copy of the portal (React + localStorage); dist/index.html runs offline
├── f5_api/                   F5 API prep (not committed yet)
│   ├── F5-API-Checks.md                       curl checks with expected output (BIG-IP DNS 16.1)
│   ├── f5-api-check.sh                        read-only check script (GET only + token login/logout)
│   ├── api_links.txt                          iControl REST, GTM API, BIG-IQ API, AS3 GSLB, VELOS API, K-articles
│   └── icontrol-rest-api-user-guide-16-1-0_8528.pdf
├── dns-portal/docs/          empty now (the old engineering pack lives in the snapshot below)
└── analysis/
    ├── 06-api-integration-handover.md   Handover for the F5 API integration: where things are, decisions,
    │                                    the code seam (DnsProvisioner), 7 design problems, first steps
    ├── 07-portal-security-review.md     Security review of portal/ (06-Nov): 22 findings SEC-01…22. INTERNAL only
    ├── sbom/SBI_SBOM_DNS_Portal.docx     Requirements-stage DRAFT SBOM (versions "to be updated"). The real-version
    │                                    SBOM is in `mail 13 Nov 2026/` (the 06-Nov real-version file was never saved here)
    └── starlight/F5/                     SNAPSHOT of the whole project folder taken 04-Nov 19:18. Holds:
        ├── analysis/01…05-*.md          document review, open questions + sources, UI screen inventory,
        │                                client questionnaire, 05-integration-flow-lld-gaps.md
        ├── analysis/starlight/          LB prerequisites .xlsx + queries .txt (single-node v2.1 version:
        │                                STALE vs v2.2), Flow.md, Flow Design.md
        ├── analysis/sbom/               older SBOM
        └── dns-portal/docs/             old engineering pack (Next.js/NestJS, SSO+MFA): NOT decisions
```

The SBOM template is `Downloads\SBI_SBOM.docx`. The old build scripts (`build_sbom_v22.py`, `build_lb.py`) were in a job tmp folder and are gone.

## 4. Source of truth

- **Proposal v2.2** (04-Nov-2026) is the agreed baseline for all updates since v2.0. Its points need no separate Bank confirmation (decision 05-Nov): one approval, direct Checker/Admin changes, versioning and rollback, and directory users checked at every sign-in.
- **Requirements Specification v1.2** (09-Nov-2026) records all detailed requirements (IDs AUTH, ONB, PAR, DNS, CHG, SCH, VER, RPT, AUD, NFR, UAT) and the open points (section 16).
- **Internal vs external numbers (decision 13-Nov):** the documents are issued to Starlight / F5 / SBI as new versions:
  - internal proposal **v2.2** = external **Solution Proposal v2.1** (13-Nov-2026);
  - internal requirements **v1.2** = external **Requirements Specification v1.0** (13-Nov-2026).
  - The older files in `docs/` with the same numbers (v2.1 of 03-Nov, v1.0 of 05-Nov) are different internal drafts. In anything sent out, cite the external numbers.
- **Stack** = Java 21 + Spring Boot, React (TypeScript), PostgreSQL 16, NGINX, Fluent Bit, on RHEL 9. Don't change the stack anywhere without asking.
  - FastAPI (in `requiments.md`) and NestJS/Next.js (in the old pack) are **not** decisions.

## 5. RFP requirements in one line each (J1–J5)

- **J1 Functional:** web tool for all DNS tasks; MFA; user/role management; logical grouping (department/app/location); fetch + sync all records from F5; Search/List/Select/Add/Modify/Delete privileges by group; validation (duplicate, CNAME loop, TTL, name/IP); maker-checker workflow with scheduling; workflow finalised with Bank; scalable; dashboards (records per department).
- **J2 Integration:** AD; API automation of DNS changes; ITSM for change + incident.
- **J3 Security:** audit trail to SIEM; patches; non-disruptive patching; backward compatibility; **TLS 1.3+** and encryption at rest; DoS resistance; annual VAPT.
- **J4 Availability:** HA locally and across DCs; failover; **RTO 1 min, RPO 15 min**; critical patches in 72 h.
- **J5 Support:** 24x7 with SLAs; docs/training/KT; 7 years support; all licences; Bank private-cloud VMs.

**Where we deviate or go beyond the RFP:**
- MFA has been removed (J1.2 asks for it), so a deviation is needed.
- Versioning, compare and rollback are our own addition, justified under J1.8 / J1.9.
- Direct Checker/Admin changes without approval go beyond the J1.8 maker-checker wording.
- Records are counted per partition, not per department (J1.11; open as RPT-03).

## 6. Architecture (proposal v2.2)

- Active-passive: **DC active, DR hot standby**. One portal URL through the global VIP/GSLB.
- Per site: a **local VIP / load balancer, 2 Portal App/API nodes** (stateless, 16 vCPU / 16 GB / 180 GB) and **2 PostgreSQL nodes** (16 vCPU / 32 GB / 500 GB + WAL). DC has the primary and a standby; DR has a replica and a standby.
  - Production total: 4 app + 4 DB + 2 log forwarders, plus an optional Utility/Jump Host per site.
  - UAT: 1–2 app and 1–2 DB nodes.
  - *The 1-node-per-site variant (v2.1, 03-Nov) was **reverted** in v2.2 on 04-Nov.*
- Portal HA/DR Controller (site role, DB promotion, scheduler gating, readiness URL) and an Infrastructure Fencing Adapter (isolates the failed DC through the Bank cloud API before DR promotion). Both are co-deployed, with no extra VMs.
- PostgreSQL HA uses "Patroni or equivalent", with the DCS/witness to be decided in HLD.
- Secrets are kept in the Bank Vault/KMS (or a dedicated Vault). Logs go through Fluent Bit to the SIEM.
- DNS resolution stays on F5 and does not depend on the portal.

## 7. Users, sign-in and access (v2.2 §5.5 + Requirements v1.0)

**Sign-in**
- **MFA removed from scope (03-Nov), and no SSO.**
- Users sign in with their **numeric employee ID** (e.g. 140122). Still to confirm: that the LDAP uid is the employee ID.
- **One Admin:** defined in protected config (`.env`, preferably from Vault/KMS), stored as a bcrypt hash, not in the DB, and not editable in the UI.
- **Sign-in order:**
  - Portal accounts are checked first: the Admin, local users and known directory users.
  - The **Bank LDAP directory (LDAPS bind)** is asked only for IDs the portal doesn't know.
  - Directory users are re-checked against LDAP at every sign-in, because Bank passwords are never stored.
  - If LDAP is down, only the Admin and local users can sign in.
- **Local users** get a one-time temporary password from the Admin and must change it at first sign-in.
- **Proposed password and session values** (to be replaced by the Bank IS policy):
  - Passwords: 12+ characters, mixed, expire after 90 days.
  - Lockout: 5 failed sign-ins lock the account for 15 minutes.
  - Sessions: 30 minutes idle. Server-side session with an HttpOnly, SameSite=Strict, Secure cookie.
  - Permissions are re-read on every request.

**Onboarding**
- A first directory sign-in creates a profile with "Pending access".
- The user then raises an **access request**: department (from a dropdown), access needed, partitions and a reason.
- The Admin grants it as asked, adjusts it, or declines it with a reason. A declined user can ask again.
- The Admin can also look up an ID in the directory and grant access before the first sign-in.
- The directory gives only ID, name and email. **Department** is information only, entered by the user and kept by the portal; the list is set in `DEPARTMENTS` in `.env`.
- Notifications are **in-app only** (counts on the menu and dashboard), with no e-mail.

**Partitions**
- Groups are **F5 BIG-IP partitions**. Every record belongs to exactly one partition.
- The Admin creates, renames and deletes partitions. Names follow the F5 rule: start with a letter; letters, digits and `_ - .`; at most 64 characters.
- A partition that owns records or history can't be deleted.

**Access levels** (the Admin gives each user exactly one):

| | Read | Read + Write | Checker | Admin |
|---|---|---|---|---|
| See records | All partitions | Own partitions | All | All |
| Create / modify / delete | No | Own partitions, needs approval | All, direct | All, direct |
| Approve / reject Write requests | No | No | Yes, not own | Yes, not own |
| Compare versions, roll back | No | No | No | Yes |
| Users, access requests, partitions, audit | No | No | No | Yes |

- A Write request goes to **all Checkers and the Admin**. One approval applies it, and a rejection needs a comment.
- Checker and Admin changes, and Admin rollbacks, are validated and applied directly, and audited as direct changes.

## 8. DNS records, changes, scheduling, versions (Requirements v1.0)

**Scope this phase**
- Mapping types: **one-to-one, one-to-many (2–32 IPs) and PTR**.
- **IPv4 → A, IPv6 → AAAA.** The portal picks the type from the address, and PTR names are generated.
- **Later or undecided:**
  - CNAME, MX, TXT, NS, SRV, and CNAME loop checks.
  - Wide IPs, pools, monitors and topology.
  - Full sync from F5 (J1.5).
  - ITSM.

**Validation**
- FQDN rules; IPs not 0.0.0.0 or 255.255.255.255; no repeated IPs; TTL from 60 to 86,400 (default 3,600).
- Only one active record per name (or per IP for PTR), and one open request per record.
- A record's name can't be changed; delete it and create a new one.

**Execution**
- The portal re-checks that the record is still at the expected version; if not, the change fails safely.
- Each change is applied at DC, DR and AZ, and the **F5 result is stored per site**.
- On failure, the request shows the **F5 error code and message exactly as returned**, per site.
- A failed change creates no version, and a change can never be applied twice.

**Scheduling (decided 05-Nov)**
- **Only modify of existing records and Admin rollbacks can be scheduled.** Create and delete are never scheduled.
- The time must be 1 minute to 90 days ahead; it's shown in the user's time zone and stored in UTC.
- Only the **Active** site runs jobs.
- A stale scheduled change fails safely, and a stale scheduled rollback is **held** for the Admin.

**Versions**
- Records start at v1.0, and each successful change adds 0.1. Each version is a full snapshot that can't be changed.
- A delete creates a final "deleted" version.
- **Admin only:** compare any two versions and roll back, now or scheduled. A rollback creates a new version (1.3 → 1.1 gives 1.4) and can restore deleted records.

**Reports, audit and logs**
- **Dashboard:** totals, queues, applied/failed/scheduled counts, pending users, records per partition, health.
- **Audit trail:** append-only, so the DB refuses changes and deletes. Kept **7 years** in the DB.
- **Log files:** audit, app and access logs as JSON lines with a requestId, rotated. Kept 365 days for audit and 180 days for app and access (CERT-In).
- **Fluent Bit** forwards the logs to the SIEM; the SIEM output is still to be configured.

## 9. Build status (portal increment 1, as of 05/06-Nov-2026)

**`portal/`** (Docker Compose, http://localhost:8088; DB on localhost:5433)

The local dev versions below are **actual**, not just planned:

| Service | Image / version |
|---|---|
| frontend | NGINX **1.27.5** (`nginx:1.27-alpine`, Alpine 3.21); React 18.3.1, react-router-dom 6.28.0, TypeScript 5.6.3, Vite 5.4.11 (built on `node:22-alpine`) |
| backend | Spring Boot **3.4.1** (Spring 6.2.1, Security 6.4.2, Hibernate 6.6.4, Tomcat 10.1.34, Flyway 10.20.1) on **Temurin 21.0.13+9** (`eclipse-temurin:21-jre`, Ubuntu 26.04.1); built with `maven:3.9.9-eclipse-temurin-21`. App version **0.1.0** |
| db | PostgreSQL **16.15** (`postgres:16-alpine`, Alpine 3.24) |
| ldap | **Mock** Bank directory, `osixia/openldap:1.5.0` (dev only) |
| fluent-bit | `fluent/fluent-bit:3.1.9` (prints only for now) |

**Built:**
- Sign-in, onboarding and access requests, department dropdown, partitions, all 5 access levels (Auditor added 09-Nov, migration V4; not committed yet).
- Maker-checker and direct changes.
- A record (one-to-one / one-to-many) and PTR.
- Scheduling (modify only), versions, compare and rollback, held rollbacks, restoring deleted records.
- Per-site results with mock F5 errors (domains ending `.fail.test` fail at DR).
- Append-only audit, JSON log files, CSRF and security headers, and login rate limiting in NGINX.
- bcrypt with cost 12.

**Not built yet:**
- Real F5 integration (behind the `DnsProvisioner` interface; `MockF5Provisioner` today).
- **IPv6/AAAA**: the DB allows only A and PTR.
- Moving a record to another partition.
- Live drift check from F5.
- ITSM and F5 sync.
- Other record types.
- MFA/SSO (left out on purpose).

**Test data** (`SAMPLE_DATA=true`, local only):
- Users: admin / `Admin@Portal2026`; 140122 Pravez and 140123 Abhash (local R+W); 140124 Anoop Tiwari and 140125 Rahul KP (LDAP, to be granted Checker); 140126 Paras Mahajan (LDAP, raises an access request). The password for all the numbered users is `12345677`.
- Partitions: Internet_Banking, Core_Banking, UPI_Payments.

**Tests and other code**
- Portal API tests are **not in the repo** yet; the handover says to add them.
- `static-portal/` has the same rules ported to TypeScript in `src/mock/`. `npm test` runs 85 checks (all passing on 12-Nov, Auditor included). It's tracked in the workspace repo.
- **Code guide:** `portal/arch/` (10-Nov) documents the code; `arch/12-decisions-and-gaps.md` lists the gaps G1–G11 against the requirements. `portal/README.md` is behind the code (no Auditor).
- **Git (12-Nov):** on GitHub, PR #1 merged `addn` into `dev` only up to `f4f72d5`; the department-dropdown commit `f37c6ad` is not on `dev`, and `main` is still `b679329`.
- **Security review** (`analysis/07-portal-security-review.md`, 06-Nov, internal): no SQL injection / XSS / CSRF / IDOR found; 22 findings. SEC-01/02/03 (no MFA, Admin in `.env`, direct changes) were kept by decision on 09-Nov; SEC-14 is partly fixed by the Auditor level; the rest are open.
- **F5 integration design problems** (handover §5):
  - no F5 calls inside a DB transaction;
  - no double apply;
  - partial failure across sites;
  - mapping records to F5 objects;
  - drift and sync;
  - a least-privilege API account;
  - errors passed through unchanged.

## 10. Bank answers (04-Nov-2026)

- **Directory:** LDAP (LDAPS bind). The URL, base DN, filter, service account, attributes and test users are still to be received.
- **F5 UAT (BIG-IP VE):** access comes **after** F5 shares the API docs.
- **ITSM:** **on hold** at the Bank. Build behind a feature flag with a mock.
- **Sample DNS data:** the user will try to provide it.
- **Groups:** no Bank list is needed; the Admin creates partitions in the portal.
- **DNS form rules:** to be asked with the F5 API docs. **SIEM format:** to be asked.
- **F5 API documentation request:** mailed. Still missing from it: ZoneRunner/standard records including PTR, sync-group behaviour, transactions, save-config, BIG-IQ vs BIG-IP, VELOS F5OS health, API user role, TLS, limits and version.

## 11. Decision log

| Date | Decision |
|---|---|
| 27-Oct | F5 logo in the UI for now; deliverables kept as local files |
| 29-Oct | Outgoing docs as Starlight Data Solutions, no Azalio; LB docs address the "LB team" and have no Owner column |
| 03-Nov | Portal accounts first, then Bank LDAP; no SSO; **MFA removed** (deviation needed) |
| 03-Nov | One config-defined Admin, hash only, not editable in the UI |
| 04-Nov | v2.2 permission model; Admin changes and rollbacks direct; F5 errors shown raw per site |
| 04-Nov | Groups = F5 partitions, created by the Admin; directory is LDAP; ITSM on hold |
| 04-Nov | Sign-in with numeric employee ID; Admin can pre-grant by ID lookup; logs as JSON files |
| 04-Nov | v2.2 reverts to 2 app nodes per site + local VIP |
| 05-Nov | Department entered by the user in the access request (the directory doesn't provide it) |
| 05-Nov | Only modify and Admin rollback can be scheduled; IPv4 → A, IPv6 → AAAA; in-app notifications only |
| 05-Nov | v2.2 is the agreed baseline; stack Java/Spring Boot + React |
| 06-Nov | **SBI reply on the SBOM:** "The timeline mentioned as Draft. We understand that this is final SBOM, and there is no change at the initial deployment. We recommend an enterprise version for software to be deployed for the project." So the versions are frozen for the initial deployment, and enterprise editions are expected (open point B11) |
| 06-Nov | UAT requirements added as Requirements v1.1 §14 (environment, software versions/editions, integrations and test data, test scope, entry/exit criteria, roles/timeline) |
| 09-Nov | **No MFA** stays (the security review's "High" rating is noted; deviation B1 is for the Bank to accept) |
| 09-Nov | **Admin stays in `.env`** (bcrypt hash) in every environment, including UAT and production |
| 09-Nov | **Checker and Admin change records directly**, no second approval (as in v2.2) |
| 09-Nov | **New Auditor access level**: view only across all partitions (records, versions incl. compare, change requests), plus the audit trail, users and access requests (view only); cannot change, approve or administer anything. Built in `portal/` (DB migration V4) and `static-portal/` |
| 09-Nov | **Partitions and departments will be made from the F5 API result.** Until then the Admin creates the departments (written in Requirements v1.2; the code still uses the `DEPARTMENTS` list in `.env`) |
| 09-Nov | **Two portal app nodes each at DC and DR** (v2.2) |
| 09-Nov | **F5 API credentials in `.env` for now**; where DB/LDAP/F5 credentials live in UAT/production is open (NFR-SEC-03, B15) |
| 09-Nov | **IPv6/AAAA** stays a requirement; the build (IPv4 only today) adds it together with the F5 integration |
| 09-Nov | Requirements **v1.2** issued (`docs/F5-DNS-Portal-Requirements-v1.2.docx/.pdf`): the decisions above; v1.1 kept unchanged |
| 13-Nov | **Documents issued as new versions:** internal proposal v2.2 → external **Solution Proposal v2.1**, internal requirements v1.2 → external **Requirements v1.0**, both dated 13-Nov-2026 and cleaned of every Azalio trace. Kept in `mail 13 Nov 2026/`; the originals in `docs/` are unchanged |
| 13-Nov | **Status mail** drafted: progress, weekly plan, next steps; asks Starlight for the F5 API documentation, the record-management method and one unit-testing environment (test F5 GTM) to test the F5 API; asks SBI (once development is done) for a RHEL 9 test server and the prototype requirements. Attachments: requirements v1.0, proposal v2.1, SBOM (and optionally the timeline). Asks the recipient to approve the documents or say what to change |
| 13-Nov | **Development timeline v1.0** (tentative): DB design 16-Nov → back end → front end → unit tests (to 2-Dec) → **F5 API setup needed by 2-Dec** → F5 integration 3–15 Dec → SIT 16–21 Dec → test-server deployment 22–23 Dec → working prototype **31-Dec-2026**. A late F5 setup moves steps 7–13 by the same delay |
| 13-Nov | **SBOM rebuilt** with the real dev-build versions (see §13) |

## 12. Open points (Requirements v1.2 §16)

**For the Bank (via F5)**
- **B1:** MFA deviation.
- **B2:** password, lockout and session policy.
- **B3:** LDAP details, and whether uid = employee ID.
- **B4:** ITSM product, API and depth. Does an ITSM approval also gate execution? Proposed: ticket and status only.
- **B5:** form fields, further record types, object scope.
- **B6:** volumes (compliance E1: up to 500 zones × 1 lakh records) and sample data.
- **B7:** SIEM product, format, transport and log retention.
- **B8:** RTO for one server vs the whole DC; TLS 1.3 deviation (the F5 management API is TLS 1.2 only; compliance J3.5 = N).
- **B9:** reports; records per department vs per partition.
- **B10:** branding (F5 logo for now).
- **B11:** enterprise editions: which components move to a paid edition and who provides the licences; then re-issue the SBOM as final.
- **B12:** UAT environment (site, VMs, network, URL, certificate, start date).
- **B13:** UAT integrations and data (LDAP test users, test SIEM, Vault/KMS, sample DNS data, HA rehearsal, VAPT on UAT).
- **B14:** UAT test cases, defect severity, acceptance criteria and sign-off.
- **B15:** where the DB, LDAP and F5 credentials are kept in UAT and production (Vault/KMS or `.env`).

**For F5**
- **F1:** REST API documentation.
  - ⚠ **13-Nov finding, F5 article K14724629:** iControl REST does **not** support managing ZoneRunner (BIND), on any BIG-IP DNS version. If SBI's A/AAAA/PTR records live in ZoneRunner zones, the portal can't change them through REST. F5 must confirm the supported method (Wide IPs through the GTM API, DNS Express + zone transfer, or DNS dynamic update with TSIG). Asked in the 13-Nov mail.
  - The 5 my.f5.com K-articles in `f5_api/api_links.txt` do open (they load with JavaScript): K16153652 REST components by product, K45508216 REST table of contents, K14724629 ZoneRunner not supported, K000152849 VELOS interface state via F5OS-C API, K000092968 F5OS REST parameters from the CLI. `F5-API-Checks.md` Appendix C saying they couldn't be read is outdated.
- **F2:** BIG-IQ CM or direct BIG-IP (iControl REST).
- **F3:** how partitions apply to DNS objects.
- **F4:** reading live configuration (drift and sync).
- **F5:** UAT BIG-IP VE and a least-privilege API account.

**Design points to confirm**
- **D1:** can the approving Checker cancel a scheduled update? Proposed: only the maker.
- **D2:** should a schedule lock the record (proposed: no), and what happens to a late approval (proposed: refuse)?
- **D3:** suggest partitions from the department?
- **D4:** extra session controls.

All 12 SBI queries and 12 F5 internal confirmations in the 29-Jul-2026 workbook are still **Open**; no replies have been recorded.

## 13. Deliverables status

| Deliverable | Where | Status |
|---|---|---|
| SBOM (Bank format) | `mail 13 Nov 2026/SBI_SBOM_DNS_Portal.docx/.pdf` | **Rebuilt 13-Nov** (the 06-Nov real-version file was never saved; `analysis/sbom/` holds only the requirements-stage draft). 21 pages, 10 components with real dev-build versions: Portal 0.1.0, React 18.3.1, Spring Boot 3.4.1, Temurin 21.0.13+9, PostgreSQL 16.15, NGINX 1.27.5, Fluent Bit 3.1.9; Patroni, Vault/KMS, RHEL 9 planned. JAR SHA-256 `cc5b992a…b88`. Annex A = 76 back-end Java libraries with licences; Annex B = 10 front-end runtime packages. Release and EOL dates checked 13-Nov (Spring Boot 3.4 OSS support ended 31-Dec-2025, commercial ends 31-Dec-2026; NGINX 1.27 ended 24-Jun-2025; Fluent Bit 3.1 ended 12-Feb-2025; PostgreSQL 16.16 out 12-Nov-2026; Temurin 21 supported to 31-Dec-2029). Lists known CVEs (Spring Security CVE-2025-22228, Tomcat CVE-2025-24813, Logback CVE-2024-12798/12801, pgjdbc CVE-2025-49146, react-router-dom 6.28.0 advisories). **No full vulnerability scan yet; container image digests missing** (Docker didn't start) |
| Development timeline | `mail 13 Nov 2026/F5-DNS-Portal-Development-Timeline-v1.0` | 13-Nov, tentative, 16-Nov → 31-Dec-2026 (see decision log) |
| Status mail | `mail 13 Nov 2026/mail-13-Nov-2026.html` | 13-Nov draft; the user's final text is in chat, the HTML still has the timeline section |
| Security review | `analysis/07-portal-security-review.md` | 06-Nov, internal only; don't push it to a public repo |
| LB prerequisites + queries | snapshot `analysis/starlight/F5/analysis/starlight/` | ⚠ **Stale:** written for v2.1's 1 node per site and no local VIP. v2.2 needs a local VIP and 2 nodes per site again |
| Requirements Specification | `docs/…-v1.2` (internal) = `mail 13 Nov 2026/…-v1.0` (external) | Current; v0.1/v0.2 are internal only |
| Proposal | `docs/…-v2.2` (internal) = `mail 13 Nov 2026/…-v2.1` (external, Azalio-free) | Baseline; see the document issues below |
| F5 API request | `requiments.md` | Mailed (per 04-Nov notes); the local file still says FastAPI |
| Client questionnaire, UI inventory, open questions | snapshot `analysis/starlight/F5/analysis/01–05` | From 27–29 Oct; partly superseded by Requirements v1.0 |

## 14. Known document issues

- The proposal still cites old **K1–K5** numbering (12 times); the RFP now uses **J1–J5**.
- The proposal says "TLS 1.3"; the compliance sheet says TLS 1.2 max for the F5 management API.
- The compliance sheet is missing **J4.3** (RTO/RPO) and **J4.4** (72-hour patching).
- The proposal recommends a quorum/witness but sizes none.
- **Internal v2.1/v2.2 in `docs/` still contain Azalio** (visible: the HA/DR "Azalio Portal HA/DR orchestration" sentence and the RACI column header; hidden: style names "Azalio Section/Subsection" and author "Azalio Technologies"). **Fixed in the external v2.1 of 13-Nov** (`mail 13 Nov 2026/`): "The portal HA/DR orchestration…", RACI header "Starlight Data Solutions", styles renamed "Portal Section/Subsection", author Starlight. Always send the external file.
- v2.2 Figure 4 shows only the maker → approval path, not the direct Checker/Admin path. The figures still say Requester/Approver/Admin.
- Requirements v1.0 says "Read + Write"; v2.2 says "Write (maker)". They mean the same.

## 15. Gantt (20 weeks, start date not fixed)

Planning W1–W4 · Design W3–W7 (sign-off end W6) · Build/Integration W6–W14 · Test/UAT W13–W19 · Cutover W19 · Go-live W20.

## 16. Next steps

- [ ] Send the 13-Nov status mail with the external Requirements v1.0, Proposal v2.1 and SBOM (and the timeline if wanted); follow up for approval of the documents.
- [ ] Get from F5 (via Starlight): the API docs, the supported method for A/AAAA/PTR records (ZoneRunner is not REST-managed), and a test F5 GTM with a least-privilege API account by **2-Dec** (timeline dependency).
- [ ] Fix "FastAPI" → Java/Spring Boot in `requiments.md`; chase F5 for the API docs and UAT BIG-IP VE.
- [ ] Commit the uncommitted work: `portal/` (Auditor, V4, `arch/`) and the workspace (`context.md`, `static-portal/`, docs v1.1/v1.2, `f5_api/`, `analysis/sbom/`, `mail 13 Nov 2026/`, portal pointer). Keep `analysis/07-portal-security-review.md` out until the GitHub repo is known to be private.
- [ ] Update `portal/README.md` for the Auditor level and migrations V3–V4.
- [ ] SBOM: add container image digests and a full vulnerability scan (Trivy / OWASP Dependency-Check) once Docker is running; note that HashiCorp Vault is **not open source** (Business Source License since Aug-2023; OpenBao is the MPL-2.0 open-source fork) if a dedicated Vault is chosen (B15).
- [ ] F5 integration (handover §5–7): execution state machine, per-site idempotency, and `F5Provisioner` behind `F5_MODE`.
- [ ] Build IPv6 / AAAA (DNS-02) before the F5 mapping; add portal API tests to the repo.
- [ ] Update the LB prerequisites and queries for v2.2 (local VIP + 2 nodes per site), then mail the LB team.
- [x] SBOM filled with the real dev-build versions (06-Nov; file lost, rebuilt 13-Nov in `mail 13 Nov 2026/`).
- [x] Proposal and requirements de-branded and issued as external v2.1 / v1.0 (13-Nov).
- [x] Development timeline v1.0 written (13-Nov).
- [ ] Before UAT: upgrade Spring Boot to a supported line and NGINX to a maintained branch; review Fluent Bit; pin `postgres:16-alpine` to an exact version; run a vulnerability scan (Trivy / OWASP Dependency-Check) and add the results to the SBOM.
- [ ] Clean the remaining Azalio traces: the GitHub account name in the `portal` remote (the documents are clean in the external pack).
- [ ] Send the Bank open points B1–B14 (via F5) and the F5 points F1–F5. B11–B14 are new in v1.1: enterprise editions and licences, UAT environment, UAT integrations/data, UAT acceptance.
- [ ] ⚠ **Before SBI freezes the SBOM:** the SBOM SBI calls "final" was the dev-build draft, with Spring Boot 3.4.1 (OSS support ended) and NGINX 1.27.5 (unmaintained branch), no vulnerability scan, and Patroni/Vault/RHEL minor not fixed. Agree the final versions and editions (B11), then re-issue the SBOM as final.
- [ ] Remove the `5433` DB port and `SAMPLE_DATA` for UAT/production; set `COOKIE_SECURE=true`; secrets go in Vault/KMS.
