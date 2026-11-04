# 00 · Context & Decisions

Sources: SBI RFP Section J (pp. 73–76), F5↔Azalio email thread (27–29 Jul 2026), Azalio Proposal v2.0 (17 Aug 2026), compliance workbook `SBI-DNS-Revised-Azalio-updated.xlsx`, 20-week Gantt.

## 1. What we are building

SBI is replacing its DNS with **F5 BIG-IP DNS** (VELOS CX410 chassis, active-active across **DC, DR, AZ**). F5 is the OEM/bidder. RFP Section J also requires a **front-end DNS management portal**. F5 has no product for that, so **Azalio builds it**.

The portal is the **management and governance plane** only. F5 stays the authoritative **resolution plane**, and DNS resolution must keep working if the portal is down.

## 2. Functional scope (RFP J1–J2)

| # | Capability |
|---|---|
| J1.1 | Single web tool for all front-end DNS record management |
| J1.2/J2.1 | AD/IdP SSO, **MFA enforced for every user**, AD group fetch. *Design response (Proposal v2.1/v2.2): portal login, with local users first and then Bank LDAP/directory validation; groups and permissions managed in the portal; **no SSO and no MFA (deviation to agree)**. See LLD §5.1, §8, §9.2* |
| J1.3 | Manage users, service identities, roles, privileges |
| J1.4 | Logical grouping of records: department, user group, application, location |
| J1.5 | Fetch and list **all** records from F5, kept in sync |
| J1.6 | Privileges Search/List/Select/Create/Modify/Delete, assignable to user or group, scoped to a logical group |
| J1.7 | Pre-create validation: duplicates, CNAME loops, TTL, name/IP format |
| J1.8 | Workflow for create/modify/schedule with **maker-checker**; checker groups managed separately |
| J1.9 | Workflow finalised jointly with SBI, so it must be **configurable, not hard-coded** |
| J1.10 | Scale with growth in records, users, departments |
| J1.11/H24 | Reports and dashboards, including records per department |
| J2.2 | Automation via APIs |
| J2.3 | ITSM (BMC) integration for **change and incident** |

## 3. Non-functional scope (RFP J3–J5)

| # | Requirement | Design response |
|---|---|---|
| J3.1 | Full audit trail, exportable to SIEM | Append-only hash-chained audit and a SIEM stream |
| J3.3/J3.4 | Non-disruptive, backward-compatible patching | Rolling deploys, expand/contract DB migrations, versioned API |
| J3.5 | **TLS 1.3** everywhere; data encrypted at rest | TLS 1.3 on every portal hop. **F5 management API is TLS 1.2 only**, so a deviation is needed |
| J3.6 | Resist DoS on management functions | WAF, per-user/IP rate limits, queue backpressure |
| J3.7 | Annual VAPT plus remediation | SAST/DAST/SCA in CI, remediation SLA |
| J4.1/J4.2 | HA locally **and across DCs** | Active-active stateless tier; Patroni + 3-site etcd quorum |
| J4.3 | **RTO ≤ 1 min, RPO ≤ 15 min** | Automated DB failover in about 30–45 s; RPO a few seconds |
| J4.4 | Critical patches within 72 h | Reproducible container images, CI pipeline |
| J5 | 24x7 support, 7-year maintenance, KT to Bank and NI | Runbooks, LTS dependency policy |
| J5.5 | Portal on Bank private-cloud VMs | VM or OpenShift deployment, sized in LLD §12 |

## 4. Scale assumptions (design targets)

The RFP sizes the **DNS platform** at ≥500 zones × ≥1 lakh records each (E1) and ≥200 simultaneous RR updates (E5). The portal must not be the bottleneck.

| Metric | Target |
|---|---|
| Records in inventory | **10 M** (tested); 50 M supported by partitioning |
| Zones | 1,000 |
| Named users / concurrent sessions | 20,000 / 2,000 |
| API read throughput | 1,000 req/s sustained per site |
| Change-request intake (UI + API) | 200 CR/s burst; bulk CR of 10,000 items |
| Simultaneous RR updates in flight | ≥ 200 (E5) |
| Search p95 / list p95 / submit p95 | < 500 ms / < 300 ms / < 1 s |
| Change visible on F5 after approval (unscheduled) | p95 < 30 s, subject to F5 API limits |

**Key insight:** the real throughput ceiling is the **F5 management API**: iControl REST is slow, and concurrent calls return 503. The portal must therefore **queue, batch per zone, serialise per zone, and rate-limit per F5 target**. Making the web tier faster does not help.

## 5. Technology decision (changes from Proposal v2.0)

| Concern | v2.0 | **New** | Why |
|---|---|---|---|
| UI | React SPA | **Next.js 15 (App Router) + TypeScript** | SSR for large tables, one language end to end |
| API / workers | Spring Boot | **NestJS (TypeScript, Node 22 LTS)** | Shares types, validators and zod schemas with the UI |
| DB | PostgreSQL + Patroni | **PostgreSQL 16 + Patroni + etcd (3 sites)** | Witness at the AZ site gives a real quorum, so the custom fencing adapter goes away |
| Queue | Not specified | **Postgres-backed durable queue (Graphile Worker)** behind a `JobQueue` port | Transactional with business data; no second stateful system to replicate for DR; still far above F5's throughput. Swap to Kafka/RabbitMQ only if the Bank mandates it |
| Cache | None | **Redis 7 (Sentinel, per site)** | Permission cache, hot inventory pages, rate limits, idempotency. Disposable, so no DR replication |
| Search | Postgres | **Postgres `pg_trgm` + partitioning**; OpenSearch optional | Meets p95 at 10 M rows; avoids another cluster unless needed |
| HA/DR controller | Custom controller + fencing adapter | **Removed** | Stateless app is active-active in both sites; Patroni/etcd owns DB leadership; queue lives in the DB |
| Logs | Fluent Bit | Fluent Bit (DaemonSet/agent) | Unchanged |
| Secrets | Vault/KMS | Bank Vault/KMS | Unchanged |

Rule: **only PostgreSQL holds durable state.** Redis and app nodes can be lost without data loss, which keeps RTO/RPO simple.

## 6. Open decisions (must be closed in weeks 1–2)

| ID | Question | Owner | Default if unanswered |
|---|---|---|---|
| D1 | Write path to F5: BIG-IQ CM API, iControl REST per BIG-IP, or **RFC 2136 DNS UPDATE + TSIG** to ZoneRunner | F5 | Pluggable `F5Driver`; PoC all three in week 2 and pick the fastest supported |
| D2 | Does the BIG-IP DNS sync group replicate zone data across DC/DR/AZ (write once) or not (fan out to all sites)? | F5 | Support both via `zone_target.mode` |
| D3 | Object scope: resource records only, or also Wide IPs / pools / monitors / DNSSEC? | SBI via F5 | RRs only (A, AAAA, CNAME, MX, NS, PTR, TXT, SRV, CAA, DS, NAPTR) |
| D4 | TLS 1.3 to the F5 management plane | F5 / SBI | Deviation request; TLS 1.2 with strong ciphers on that hop only |
| D5 | RTO 1 min scope: node failure or full site loss? | SBI | Designed for full site loss |
| D6 | ITSM depth (BMC Helix/Remedy) | SBI | Full: create/link CRQ, gate on approval, update result, raise incident on failure |
| D7 | Legacy migration (I1) | F5 PS | Out of scope. Portal does a post-migration import and reconciliation |
| D8 | Kubernetes/OpenShift available, or plain VMs? | SBI | Containers on VMs (Podman/systemd); OpenShift manifests also provided |

## 7. Out of scope

Non-F5 DNS, IPAM/DHCP, DNSSEC key lifecycle, firmware/image management, packet capture, legacy data migration, SIEM correlation rules, native mobile apps.
