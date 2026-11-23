# 04 · RFP Section J Traceability

Each clause maps to its design section in [01-LLD.md](01-LLD.md), the code owner and the acceptance test. The **Remark** column is ready to paste into the blank cells of the compliance workbook.

| Clause | Requirement (short) | LLD § | Module | Acceptance test | Remark for workbook |
|---|---|---|---|---|---|
| J1.1 | Front-end tool for all DNS management | 1, 3 | web, api | E2E: full CR lifecycle | Centralised web portal for search, CRUD, workflow, scheduling and reporting of F5 DNS records |
| J1.2 | Access control + MFA for all users | 5.1, 10 | auth | Login order (Admin → local → LDAP), lockout, pending-access tests | Portal login with local accounts and Bank LDAP/directory validation, lockout and audited sessions. **Deviation: MFA not provided (Bank decision, 03-Nov-2026), to be agreed with SBI/F5** |
| J1.3 | Manage users, services, roles, privileges | 8 | identity, authz | User admin E2E; scope-violation and Write-cannot-approve tests | Single configuration-based Admin manages local users, LDAP users (pending-access queue), API keys and the access level per user: Read (all groups), Write (assigned DNS groups), Checker (all groups) |
| J1.4 | Logical grouping (dept, group, app, location) | 8 | grouping | Ownership + scoping tests | DNS groups (department, application, location, user group); each record has one owning group, reassignable by the Admin |
| J1.5 | Fetch, list, keep synchronised | 5.3 | worker `sync.*` | Out-of-band change detected ≤ 2 min | SOA polling plus IXFR/AXFR (or F5 API) sync with drift detection and resolution workflow |
| J1.6 | Search/List/Select/Create/Modify/Delete privileges, per user/group, per logical group | 8 | authz | Permission × scope matrix test (auto-generated) | Read (search/list/select) across all groups; Write (create/modify/delete requests) only in Admin-assigned DNS groups; Checker = Read + Write on all groups; enforced server-side |
| J1.7 | Validation: duplicate, CNAME loop, TTL, name/IP format | 7 | dns-core | ≥ 300 validator unit cases | Shared validation engine in UI, API and executor: duplicates, CNAME loops/coexistence, TTL policy, RFC name/IP/RDATA formats |
| J1.8 | Workflow create/modify/schedule; maker-checker; separate checker groups | 4.1, 4.4, 5.2, 5.4, 5.5, 8 | change, approval, schedule | Write user cannot approve; routing to all Checkers + Admin; Checker/Admin direct change; scheduled run; scheduled rollback; F5 error shown per site | Maker-checker for Write users' requests (approved by any Checker or the Admin; optional multi-level), direct changes by Checkers and the Admin without approval, scheduled execution, record versioning with compare and immediate/scheduled rollback, F5 error per site on failed changes (Proposal v2.2 §5.5) |
| J1.9 | Workflow finalised with Bank | 8 | approval | Policy change without deploy | Workflow is policy-driven configuration, finalised in design workshops without code change |
| J1.10 | Scalable | 6 | all | k6 at 10M records / 2,000 users | Horizontally scalable stateless tiers, partitioned DB, queue-based execution, caching |
| J1.11 | Reports, records per department | 6.5 | report | Dashboard vs SQL ground truth | Dashboards: records per department/group/type, CR SLA, success rates, drift; CSV/XLSX export |
| J2.1 | AD integration (groups + auth) over secure channel | 9.2 | auth, identity | LDAP validation integration test (mock + Bank UAT) | Credential validation against the Bank LDAP/directory API over LDAPS/TLS. Groups and permissions are managed in the portal, not synced from AD |
| J2.2 | Automation via APIs | 3.2, 03-openapi | api | Schemathesis contract tests | Versioned REST API (OpenAPI 3.1), portal-issued scoped API keys, idempotency keys |
| J2.3 | ITSM change + incident integration | 9.3 | worker `itsm.*` | Mock BMC: CRQ create/gate/update/incident | CRQ create/link, approval gating, evidence update, incident on failure; resilient outbox delivery |
| J3.1 | Audit trail exportable to SIEM | 9.4, 10 | audit | Tamper test; SIEM delivery test | Append-only hash-chained audit, syslog/CEF over TLS to SIEM |
| J3.2 | Regular updates/patches | 12.2 | CI/CD | Release cadence | Quarterly feature, monthly maintenance, ad-hoc security releases |
| J3.3 | Non-disruptive patching | 12.2 | deploy | Rolling deploy under load, 0 failed requests | Rolling upgrades per node and site; no portal downtime |
| J3.4 | Backward compatibility | 12.2 | db, api | N-1 compatibility test | Expand/contract migrations, versioned API with 12-month deprecation |
| J3.5 | TLS 1.3 + encryption at rest | 10 | all | testssl.sh on every endpoint | TLS 1.3 on all portal channels; at-rest encryption. **Deviation: F5 mgmt API TLS 1.2 (D4)** |
| J3.6 | Resist DoS on management | 6.7 | ingress, api | Rate-limit and WAF test | WAF, per-principal rate limits, request caps, queue backpressure |
| J3.7 | Annual VAPT + remediation | 10 | security | VAPT report closure | SAST/DAST/SCA each release; remediation within Bank SLA |
| J4.1 | HA local + across DCs | 11 | deploy | DC-loss drill | Active-active app tier in DC and DR; Patroni + 3-site etcd quorum |
| J4.2 | Failover for management continuity | 11 | deploy | Kill-tests per component | Automatic failover for node, DB and site; in-flight change reconciliation |
| J4.3 | RTO ≤ 1 min, RPO ≤ 15 min | 11 | deploy | Measured in drill | Site RTO ≤ 60 s; RPO 0 (local) / seconds (cross-site) |
| J4.4 | Critical patch ≤ 72 h | 10, 12.2 | CI/CD | Patch drill | Automated build/scan/deploy pipeline supports 72 h critical patching |
| J5.1 | 24x7 support with SLAs | – | support | – | 24x7 L1/L2 with defined severity SLAs; L3 by Azalio |
| J5.2 | Docs, training, KT to Bank and NI | – | – | KT sign-off | Admin, user and API guides, runbooks, KT sessions for Bank and NI |
| J5.3 | 7-year support | – | – | – | 7-year maintenance with LTS dependency policy (Node LTS, PG major upgrades planned) |
| J5.4 | All licences/dependencies included | 0 §5 | – | SBOM | Open-source stack; SBOM per release; no third-party licence cost |
| J5.5 | Physical or virtual on Bank private cloud | 12.1 | deploy | – | Containerised; runs on Bank VMs or OpenShift, sized per site |

### Non-portal clauses (F5/OEM scope, per thread of 28 Jul)
H20–H22, I1 (legacy migration), I2 (OEM PS deploy), I4, I6 and the OEM certification part of I7 belong to the F5/bidder. The portal touches them only through post-migration import (I1) and portal KT (I7).
