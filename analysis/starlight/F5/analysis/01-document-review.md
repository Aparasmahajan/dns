# SBI DNS Portal – Document Review

Date: 27 Oct 2026. Source files are in `docs/`.

## 1. What each document is

| File | What it is |
|---|---|
| `Portal specification.pdf` | SBI RFP extract, pages 73–76 of 166. Clauses H20–H24, I1–I7 and **J1–J5 (the portal requirements)**. |
| `SBI-DNS-Revised-Azalio-updated.xlsx` | Compliance sheet for the **whole F5 DNS bid** (sections A–J), with Y/N answers and remarks. Azalio wrote the J1 remarks. |
| `F5-DNS-Portal-Solution-Proposal-v2.0.docx` | Azalio proposal v2.0, dated 17 Aug 2026 (v1.0: 23 Nov 2025). Approver field blank. |
| `RE_ Portal requirement for F5 DNS.eml` | Email thread, 8 Nov 2025 to 29 Jul 2026, Azalio ↔ F5. Attachment: `SBI_DNS_Portal_RFP_Queries_and_F5_Confirmations.xlsx`. |
| `SBI_F5 DNS Project Plan Gantt Chart.png` | 20-week plan, 26 activities, milestones M1–M6. |

**Context:** SBI is buying F5 BIG-IP DNS (GTM) on VELOS CX410 across DC, DR and AZ. RFP Section J requires a custom "front-end solution" (the portal). Azalio is the portal supplier under F5 / the winning bidder. The bid goes to a reverse auction; F5 has pushed hard on cost.

**Starlight** = the company that maintains the load balancer.

## 2. What the RFP requires (J1–J5)

**J1 Functional**
1. Front-end tool for all DNS management tasks by authorized users.
2. Access control and MFA for all users.
3. Manage users, services, role-based privileges.
4. Logical grouping of records by department, user group, application, location.
5. Fetch and list all resource records from F5 and keep them synchronized.
6. Privileges: Search, List, Select, Add/Create, Modify, Delete – assignable to users/groups, scoped to logical groups.
7. Validation before creation: duplicate check, CNAME loop prevention, TTL validation, name/IP format.
8. Workflow for create, modify and change schedules, with maker-checker; maker and checker groups managed separately.
9. Workflow finalized with the Bank, including additions not in the RFP.
10. Scalable for growth in records, users, departmental domains.
11. Reporting, analytics, dashboards incl. records per department.

**J2 Integration:** AD over secure channels; automation of DNS changes via API; ITSM for change and incident management.

**J3 Security:** audit trail to SIEM; regular patches; non-disruptive patching; backward compatibility; TLS 1.3+ and encryption at rest; DoS/DDoS resistance; annual VA/PT.

**J4 Availability:** HA (active-active or active-passive) locally and across DCs; failover; RTO 1 minute, RPO 15 minutes; critical patches within 72 hours.

**J5 Support:** 24x7 with SLAs; documentation, training, KT to Bank and NI; 7 years support; all licences included; physical servers or Bank private-cloud VMs.

Changes from the old K1–K5: J1.7 adds name/IP validation; J3.5 moves TLS 1.2 → 1.3; J5.5 adds "Centralized Manager and Data Collector" (BIG-IQ CM / DCD).

## 3. What proposal v2.0 says

- Active-passive DC/DR. Single portal URL behind global VIP/GSLB, local VIP per site.
- 2 app + 2 PostgreSQL nodes per site (DC: primary + local standby; DR: replica + standby).
- Portal HA/DR Controller (site role, DB promotion, scheduler gating, readiness endpoint) and Infrastructure Fencing Adapter (isolates old primary via Bank cloud API before DR promotion; blocks auto-promotion if fencing unconfirmed).
- DNS resolution stays independent of the portal.
- Layers: Presentation, Application, Data & Security, Integration.
- Roles: requester, approver, admin, auditor. States: pending, approved, scheduled, executed, rejected.
- Out of scope: non-F5 DNS, IPAM/DHCP, reverse-zone automation beyond records, DNSSEC key lifecycle, F5 firmware/packet capture, SIEM correlation rules, mobile apps.

## 4. Discrepancies and gaps

### Inconsistencies
1. **TLS conflict:** proposal says "TLS 1.3"; compliance J3.5 is **N** ("Maximum of TLS 1.2 supported… for management portal and iRest Control API").
2. Proposal still cites **K1–K5**; RFP now uses **J1–J5**.
3. Compliance sheet is missing **J4.3 (RTO/RPO)** and **J4.4 (72-hour patching)** (rows 145–148), and J1.7 item d (name/IP validation). Section I wording differs from the PDF.
4. J rows marked Y with no remark: J1.7, J1.8, J1.10, J2.2, J2.3, J3.1–J3.6, J4.1, J4.2. J3.7 and J5.1–J5.5 still "Bidder to Confirm".
5. Figure 1 is the old single-site diagram.
6. Vault/KMS shown at DC only in Figure 2.
7. Proposal recommends a quorum/witness but sizes none.
8. Sizing changed: Nov 2025 = 3 app + 3 DB (1 TB) single site; v2.0 = 2+2 per site (500 GB + WAL).

### Not covered anywhere
- Scale: compliance E1 = 500 zones × 1 lakh records (max 5 crore); E5 = 200 simultaneous updates.
- Record types not listed in the proposal.
- Incomplete request states (failed, partial, cancelled, rolled back).
- No rollback design; partial-failure behaviour undefined.
- Drift detection, bulk operations, notifications not designed.
- Encryption at rest mechanism; audit retention; DoS protection; patching method.
- Monitoring stack (Prometheus only in emails).
- Compliance A8 integrations (NMS, PIMS, IDAM, LMS, NTP, SCGuard); A9 NTPv4/SHA-2; A11 PQC.
- Service/API identity auth; auditor role behaviour; approval rules; UI.

## 5. Tools and technology

| Layer | Choice | Source |
|---|---|---|
| OS | RHEL 9.x VMs | Emails |
| Backend | Java 21, Spring Boot | Proposal + emails |
| Frontend | React (TypeScript) SPA | Proposal + emails |
| Database | PostgreSQL 15/16 + Patroni; enterprise option Crunchy Data | Emails + proposal |
| Replication / backup | Streaming/WAL, PITR, pgBackRest | Proposal + emails |
| HA consensus | DCS (etcd/Consul type) – not chosen | Proposal |
| Reverse proxy / LB | F5 VIP/GSLB (preferred) or NGINX OSS | Proposal + emails |
| WAF | F5 Advanced WAF / NGINX App Protect if needed | Emails |
| Secrets | Bank Vault/KMS/HSM, else HashiCorp Vault | Proposal + emails |
| Logging | Fluent Bit or rsyslog → SIEM | Proposal + emails |
| Metrics | Prometheus exporters | Emails |
| Auth | SAML or OIDC to Bank IdP/AD + MFA | Proposal |
| F5 API | iControl REST (BIG-IP) or BIG-IQ CM API – undecided | Emails |
| ITSM | Unknown; compliance F21 hints "such as BMC" | Compliance |

## 6. Who provides what

**SBI:** VMs/storage on private cloud (prod DC, DR, UAT); inter-DC network and firewall (with NI); AD/IdP/MFA, ITSM, SIEM, PKI, Vault/KMS, backup endpoints with non-prod access; fencing API + least-privileged service identity; user identity and AD group claims; ITSM ticket status. Data still requested: sizing, ITSM details, migration details, SLAs, training.

**F5 / bidder:** BIG-IP DNS at DC/DR/AZ, BIG-IQ CM/DCD; global/local VIP/GSLB (with NI); F5 API documentation and object mapping; legacy DNS migration; record inventory and per-site execution results to the portal.

**Starlight:** load balancer maintenance – portal VIPs, GSLB, health checks, TLS termination, WAF.

## 7. Gantt (20 weeks, no start date)

| Phase | Weeks |
|---|---|
| Planning | W1–W4 |
| Design | W3–W7 (HLD/LLD W3–W6) |
| Build / Integration | W6–W14 (F5 adapter W7–W12, ITSM and SIEM W9–W12, HA/DR W11–W14) |
| Test / UAT | W13–W19 |
| Cutover / CAB | W19 |
| Go-live / hypercare | W20 |

Milestones: M1 requirements baseline, M2 design sign-off (end W6), M3 core + integrations ready, M4 DC/DR ready, M5 SIT/UAT done, M6 go-live (end W20).
