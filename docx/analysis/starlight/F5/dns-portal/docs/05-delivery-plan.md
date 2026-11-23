# 05 · Delivery Plan

The plan keeps the **20-week envelope** from the original Gantt and has been re-cut for the new stack. Sprints are 2 weeks.

## Team

| Role | FTE | Owns |
|---|---|---|
| Tech lead / architect | 1 | LLD, decisions D1–D8, code review, HA/DR |
| Backend (NestJS/TS) | 3 | api, worker, f5-driver, itsm-driver, db |
| Frontend (Next.js/TS) | 2 | web, design system, dashboards |
| DNS/F5 engineer | 0.5 | Driver PoC, F5 contract tests, sync/drift |
| DevOps/DBA | 1 | Patroni/etcd, PgBouncer, CI/CD, images, observability |
| QA (auto + perf) | 1.5 | Playwright, Schemathesis, k6, chaos |
| BA / PM | 1 | Workshops (J1.9), ITSM mapping, UAT, RACI |

## Sprint plan

| Sprint | Weeks | Goal | Exit criteria |
|---|---|---|---|
| S0 | 1–2 | **Foundations + de-risk** | **Stack decision (Spring Boot/React vs NestJS/Next.js)**, monorepo, CI, dev compose (PG, Redis, BIND as fake F5, OpenLDAP as mock Bank LDAP, WireMock ITSM). **F5 driver PoC against BIG-IP VE: write, read, IXFR, measure ops/s.** D1–D8 answered or defaulted |
| S1 | 3–4 | Identity + inventory | Login (config Admin → local users → Bank LDAP), lockout, sessions, user management + pending-access queue, DNS groups + record ownership, zones/records schema, sync from F5, search with keyset paging |
| S2 | 5–6 | Validation + CR core | `dns-core` validators, CR create/submit/edit, duplicate-open-CR, **record versions (1.0, 1.1 …)**. **HLD/LLD sign-off (M2)** |
| S3 | 7–8 | Maker-checker + permissions | Access levels (Read = all groups, Write = assigned groups, Checker = all groups), routing of Write requests to all Checkers + Admin, Write-cannot-approve, Checker/Admin direct changes, checker inbox, optional multi-level, notifications, F5 error per site on request detail |
| S4 | 9–10 | Execution engine | Queue, per-zone batching, per-target permits, retries, circuit breaker, idempotent apply, SSE progress |
| S5 | 11–12 | Integrations | ITSM (create/gate/update/incident), SIEM shipping, drift workflow, scheduling + change windows. **Core ready (M3)** |
| S6 | 13–14 | Reports + HA/DR | Dashboards, exports, **version compare (incl. live F5) and immediate/scheduled rollback**; Patroni + 3-site etcd, PgBouncer, GSLB readiness, DR deploy. **DC/DR ready (M4)** |
| S7 | 15–16 | Hardening + perf | k6 at 10M records, tuning, chaos/failover drills (RTO/RPO evidence), ZAP/Semgrep clean |
| S8 | 17–18 | VAPT + UAT | Bank VAPT remediation, UAT with Bank users, runbooks, admin/user/API guides. **SIT/UAT done (M5)** |
| S9 | 19–20 | Cutover + hypercare | CAB, production import/reconciliation from migrated F5, go-live, 2-week hypercare, KT to Bank/NI. **Go-live (M6)** |

**Critical path:** F5 access in S0 → driver decision → execution engine (S4) → DR build (S6) → VAPT (S8). Any F5/UAT-VE access delay pushes go-live by the same amount.

## Definition of Done (every story)
- Code + unit tests; `dns-core` and `authz` coverage ≥ 95 %.
- API change reflected in `03-openapi.yaml`; contract tests pass.
- Audit events emitted for every state change.
- Permissions enforced and covered by a negative test.
- p95 budget checked for new endpoints (k6 smoke).
- No High/Critical findings from Semgrep or the dependency scan.
- Runbook/README updated when operational behaviour changes.

## Local development setup (S0 deliverable)
```bash
pnpm i
pnpm dev:infra     # docker compose: postgres16, redis7, bind9 (rfc2136 fake F5), openldap (mock Bank LDAP), wiremock (ITSM)
cp .env.example .env              # ADMIN_USERNAME + ADMIN_PASSWORD_HASH (dev only), LDAP_*, F5_DRIVER=rfc2136
pnpm db:migrate && pnpm db:seed   # seed: 3 targets, 50 zones, 1M records, DNS groups, local users with Read/Write/Checker grants
pnpm dev           # web :3000, api :4000, worker
```

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| F5 write API slower or more limited than assumed | Execution latency, E5 (200 concurrent) | PoC in S0; batching; RFC 2136 path; per-target tuning |
| TLS 1.3 not supported by F5 mgmt plane | Compliance gap J3.5 | Raise deviation now (D4); isolate that hop on the mgmt VLAN |
| RTO 1 min for full site loss | Architecture cost | 3-site etcd quorum; measured drills from S6 |
| ITSM API access late | J2.3 slips | WireMock contract from BMC spec; feature-flag gating |
| Scope creep to GSLB objects (D3) | +6–8 weeks | Freeze RR-only scope in S0; change request otherwise |
| Bank infra (VMs, firewall, GSLB VIP) late | DR build slips | Infra checklist issued in week 1; RACI owners named |

## Week-1 asks to F5/SBI
1. BIG-IP VE (UAT) plus credentials, and confirmation of a DNS UPDATE/TSIG or REST path for ZoneRunner records (D1).
2. Whether the sync group replicates zone data across DC/DR/AZ (D2).
3. Final object scope (D3) and the TLS 1.3 position (D4).
4. Bank LDAP/directory API details (LDAPS bind or REST, base DN/user filter or endpoint, service account, attributes returned, UAT test accounts), and the BMC ITSM API spec plus sandbox.
5. VM, network and firewall matrix for DC, DR and an etcd witness at AZ. GSLB VIP for the portal FQDN.
