# Handover: start of the F5 API integration work

Written 05-Nov-2026 at the end of the build sessions of 03–05 Nov. Read this together with `context.md`
(the master project notes, last updated 03-Nov). This note covers what changed since then and
what the API integration work needs to know.

## 1. Where things are

```
F5/
├── context.md                     master project notes (03-Nov; see section 3 below for later decisions)
├── requiments.md                  draft request to F5 for the API documentation (items A–G).
│                                  It still says "Python FastAPI": fix to Java/Spring Boot before sending.
├── docs/
│   ├── F5-DNS-Portal-Solution-Proposal-v2.2.docx/.pdf   agreed baseline (supersedes v2.0 / v2.1)
│   ├── F5-DNS-Portal-Requirements-v1.0.docx/.pdf        requirements, for SBI + Starlight (no build status)
│   ├── F5-DNS-Portal-Requirements-v0.1/0.2              INTERNAL drafts (show build status): do not share
│   └── Portal specification.pdf                         RFP extract (J1–J5)
├── portal/                        the working portal (git repo; Docker)  ← the integration goes here
├── static-portal/                 browser-only copy of the portal (git repo, no commits yet)
└── analysis/
    ├── 06-api-integration-handover.md     this note
    └── starlight/F5/                      snapshot of the project folder taken 04-Nov 19:18:
        ├── analysis/01…05-*.md            document review, open questions, UI inventory, questionnaire,
        │                                  05-integration-flow-lld-gaps.md (LLD gaps per integration step)
        ├── analysis/sbom/SBI_SBOM_DNS_Portal.docx
        └── dns-portal/docs/               older drafts (LLD, data model, openapi.yaml). NOT decisions:
                                           the stack is Java/Spring Boot + React (proposal v2.2)
```

## 2. The portal today (run, accounts, layout)

- **Start:** `cd portal` then `docker compose up -d --build`. Portal at http://localhost:8088.
- **Database for DBeaver:** `localhost:5433` (5432 is Kestra's PostgreSQL). Database `dnsportal`, user `dnsportal`,
  password = `DB_PASSWORD` in `.env`.
- **Services:**
  - `frontend` (NGINX + React)
  - `backend` (Spring Boot, Java 21)
  - `db` (PostgreSQL 16)
  - `ldap` (mock Bank directory)
  - `fluent-bit` (log shipper; prints only)
- **Sample data:** loaded only when `SAMPLE_DATA=true` and the database is empty.

  | User ID | Name | Password | Role |
  |---|---|---|---|
  | `admin` | Admin | `Admin@Portal2026` | Admin |
  | `140122` | Pravez | `12345677` | Read + Write: Internet_Banking, UPI_Payments |
  | `140123` | Abhash | `12345677` | Read + Write: Core_Banking |
  | `140124` | Anoop Tiwari | `12345677` | directory user (Admin grants Checker) |
  | `140125` | Rahul KP | `12345677` | directory user (Admin grants Checker) |
  | `140126` | Paras Mahajan | `12345677` | directory user (raises an access request) |

  - **Partitions:** `Internet_Banking`, `Core_Banking`, `UPI_Payments`.
  - **Add mock directory users:** `.\ldap\add-user.ps1`.
- **Reset to sample data:** `docker compose down -v` then `up -d`. This wipes the database and the mock directory.
- **Uncommitted in git:** the "only updates can be scheduled" change touches 5 files (`README.md`,
  `ChangeRequestService.java`, `DeleteRecordDialog.tsx`, `EditScheduleDialog.tsx`, `RequestDrawer.tsx`).
  Commit them.
- **Tests:**
  - `static-portal`: `npm test` runs 67 checks of the same rules.
  - Portal: the API test scripts used during the build lived in a temporary folder and are **not** in the
    repo. Add portal API tests to the repo as part of the integration work.

## 3. Decisions since context.md (all reflected in requirements v1.0)

- **Baseline and stack:** proposal v2.2 is the agreed baseline. Stack: Java 21 + Spring Boot, React, PostgreSQL. No FastAPI.
- **Permissions:**
  - Read covers all partitions.
  - Read + Write covers assigned partitions only; changes need approval.
  - Checker covers all partitions and changes directly.
  - Admin is a Checker plus administration; Admin changes and rollbacks run directly.
- **Groups are F5 partitions:**
  - The Admin manages them in the portal.
  - Names follow the F5 partition rule (letter first; letters, digits, `_ - .`; no spaces; ≤64).
- **Sign-in and onboarding:**
  - Users sign in with their numeric employee ID.
  - Sign-in order: portal accounts first, then the Bank LDAP directory.
  - A first directory sign-in creates a profile with no access, and the user then raises an access request
    (department, access, partitions, reason).
  - The directory gives only ID, name and email, not the department.
  - The Admin can look up an ID and grant access before the first sign-in.
- **Scheduling:**
  - Only updates (modify) and Admin rollbacks can be scheduled; create and delete never are.
  - Jobs run only on the Active site.
  - A stale scheduled change fails safely; a stale scheduled rollback is held for the Admin.
- **Addresses:**
  - IPv4 gives A records and IPv6 gives AAAA records. The portal picks the type from the address.
  - **IPv6 / AAAA is not built yet** (the database allows `A` and `PTR` only).
- **Notifications:** in-app only, no e-mail.
- **F5 errors:** shown exactly as F5 returns them, per site (DC / DR / AZ).
- **Logs:**
  - Audit, application and access logs are JSON files with a request ID, rotated, and retained 365 / 180 / 180 days.
  - Fluent Bit forwards them; the SIEM output is still to be added.

## 4. The F5 integration seam in the code

Package `portal/backend/src/main/java/com/starlight/dnsportal/`:

| Piece | What it does today |
|---|---|
| `provisioning/DnsProvisioner` | Interface the real F5 adapter must implement: `List<SiteResult> apply(ChangeRequest)`, `LiveCheck checkLive(DnsRecord)`, `String describe()` |
| `provisioning/MockF5Provisioner` | Current implementation. Nothing is sent anywhere. A domain ending with `MOCK_F5_FAIL_SUFFIX` (`.fail.test`) fails at the 2nd site (DR) with code 400 |
| `provisioning/SiteResult` | `(site, success, code, message)`; stored per change in `change_request.execution_result` (JSONB) and shown raw |
| `provisioning/LiveCheck` | `(status MATCH / DRIFT / NOT_CHECKED, message)`; used before a rollback; DRIFT holds a rollback for the Admin |
| `change/ChangeExecutor` | Single execution engine: locks the record, prechecks (version must match), calls `provisioner.apply`, then commits a new version only if **all** sites succeed |
| `scheduling/ChangeScheduler` | Every 15 s on the Active site (`SITE_ROLE=Active`); `SELECT … FOR UPDATE SKIP LOCKED` per job |
| Config | `portal.f5.mode / sites / mock-fail-suffix` in `application.yml`; env `F5_MODE=mock`, `F5_SITES=DC,DR,AZ` |
| Data | `dns_record` (`record_type` A/PTR, `mapping_type` SINGLE/MULTI/PTR, `ips` JSONB, `ptr_name`, `revision` 10 = v1.0); `dns_group` = partition |

The static portal has the same rules in `static-portal/src/mock/changes.ts` (`provision()`, `checkLive()`). Keep it in
step when the integration changes behaviour that users see.

## 5. Design problems the real integration must solve

These are in requirements v1.0 or follow from it.

1. **No F5 calls inside a database transaction.**
   - Today `apply` runs inside the executor's transaction; that is fine for the mock but not for slow remote calls.
   - Needed: an execution state machine (e.g. QUEUED → EXECUTING per site → APPLIED / FAILED / UNKNOWN), saved
     before and after each F5 call (requirement CHG-06).
2. **No double apply.**
   - Use idempotency keys or a read-before-write check.
   - After a timeout or site failover, reconcile in-flight changes before any retry (CHG-06; proposal v2.2).
3. **Partial failure across sites.**
   - Example: DC succeeds and DR fails.
   - Today the request is marked FAILED and no version is created; with real F5, DC is then already changed.
   - Decide: compensate (undo at DC), retry DR, or rely on the sync group. This depends on F5's answer about
     sync groups (requiments.md item 13).
4. **Mapping records to F5 objects:**
   - Which F5 object a portal record becomes: ZoneRunner / DNS Express zone record, or Wide IP.
   - How the partition applies (open point F3).
   - PTR records in reverse zones.
   - AAAA records, once IPv6 is built.
5. **Drift and sync.**
   - Implement `checkLive` (before a rollback).
   - Full inventory sync and reconciliation (RFP J1.5), with paging for large volumes (up to 500 zones × 1 lakh
     records).
6. **Security.**
   - TLS: F5 management supports TLS 1.2 only; a deviation from the RFP's TLS 1.3 is open.
   - Least-privilege API account.
   - Credentials from Vault/KMS, not `.env`.
   - Token handling.
   - Timeouts and rate limits.
7. **Errors.** Pass F5's error code and message through unchanged, per site, as users see them today.

## 6. Open F5 questions (requirements v1.0, section 15.2)

| # | Question |
|---|---|
| F1 | REST API documentation: the item list in `requiments.md` (records incl. PTR, sync groups, transactions, save-config, auth, limits, error format, versions) |
| F2 | BIG-IQ Centralized Management or direct BIG-IP (iControl REST)? |
| F3 | How F5 partitions apply to the DNS objects the portal manages |
| F4 | Reading the live configuration: drift check before rollback; full sync and reconciliation (J1.5) |
| F5 | UAT access (BIG-IP VE) on the deployed version; least-privilege API account |

## 7. Suggested first steps

1. Commit the 5 pending files in `portal`. Fix "FastAPI" in `requiments.md` and send the F5 request.
2. Design the execution state machine and the per-site idempotency (section 5, items 1–3) against the
   `DnsProvisioner` interface. This can start before the F5 documentation arrives.
3. Add portal API tests to the repo, so the integration work has a safety net.
4. When the F5 documentation and UAT device arrive: build `F5Provisioner` (selected by `F5_MODE`) next to the mock.
   Keep the mock for local development and the static demo.
5. Build IPv6 / AAAA (requirement DNS-02): it changes the record model the F5 mapping uses.
