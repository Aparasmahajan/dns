# SBI DNS Portal – Open Questions with Sources

Date: 27 Oct 2026.

File short names:
- **RFP** = `Portal specification.pdf` (page = RFP footer "Page X of 166")
- **Compliance** = `SBI-DNS-Revised-Azalio-updated.xlsx`, sheet `SBI` (cell refs)
- **Proposal** = `F5-DNS-Portal-Solution-Proposal-v2.0.docx` (heading path + quote for Ctrl+F)
- **Email** = `RE_ Portal requirement for F5 DNS.eml` (sender + timestamp)
- **Workbook** = `SBI_DNS_Portal_RFP_Queries_and_F5_Confirmations.xlsx` (email attachment; sheet + row)
- **Gantt** = `SBI_F5 DNS Project Plan Gantt Chart.png` (row number)

---

## Q1. BIG-IQ CM or direct BIG-IP?

Not decided anywhere. "BIG-IP/BIG-IQ" in the proposal means "whichever F5 confirms", not both. Supporting both is possible but is an Azalio decision (~double adapter/test work).

| Doc | Location | What it says |
|---|---|---|
| RFP | p.76, J5.5 | "Front-end Solution, Centralized Manager, and Data Collector" |
| RFP | p.73, H23 | "should support API integration" |
| Compliance | B104 / D104 (H16) | Single centralized management tool → BIG-IQ link |
| Proposal | Executive Summary, para 2 | "…applicable to the selected BIG-IP/BIG-IQ software versions" |
| Proposal | Integration Layer → F5 DNS Infrastructure | "single logical block representing F5 BIG-IP/BIG-IQ DNS management endpoints" |
| Proposal | Assumptions table → "F5 API boundary" | "F5 confirms the supported BIG-IP/BIG-IQ management API/interface…" |
| Email | Navjeet, 28 Jul 2026 09:19, change point 3 + item 1 | Asks: portal → BIG-IQ CM, or portal → each BIG-IP |
| Workbook | F5 Internal Confirmations rows 6 (F1), 7 (F2), 15 (F10) | Open |
| Gantt | Row 11 | "F5 BIG-IP / BIG-IQ Integration Adapter" W7–W12 |

## Q2. Which DNS objects does the portal manage?

Azalio estimated plain records only. RFP J1.1 says "all front-end DNS management tasks", and the proposal's out-of-scope list doesn't exclude Wide IPs, pools, monitors, topology, zones – so SBI could claim them.

| Doc | Location | What it says |
|---|---|---|
| RFP | p.73, J1.1 | "all front-end DNS management tasks" |
| RFP | p.74, J1.5, J1.6 | "all resource records"; privileges on "the DNS records" |
| Compliance | B55 (F8), B56 (F9), B58 (F11), B29 (C10) | F5 capability: A, AAAA, CNAME, MX, NS, PTR, TXT, SRV, CAA; NS/SOA; PTR; all IANA |
| Compliance | D127 (J1.6 remark) | Privileges restricted to "…DNS zone" |
| Proposal | Scope of Work → Out of Scope, bullets 2–4 | Excludes IPAM/reverse zones, DNSSEC keys, device lifecycle; no record types listed |
| Email | Navjeet, 28 Jul 2026 09:19, item 9 | Earlier estimate: A, AAAA, CNAME, TXT, MX, NS, SRV, CAA, DS |
| Workbook | SBI Query Sheet row 10 (SI 6); F5 Internal row 17 (F12) | Open |

Plain records = A, AAAA, CNAME, MX, TXT, PTR, SRV, NS, CAA, DS (fixed answers in zones).
F5 GSLB objects = Wide IP, pool / pool member, monitor, topology rule, listener / profile, DNSSEC keys (answers decided live).

## Q3. Does the 1-minute RTO cover component failure or full site loss?

| Doc | Location | What it says |
|---|---|---|
| RFP | p.75, J4.1, J4.2 | HA "locally as well as across datacenters"; failover |
| RFP | p.76, J4.3 | "RTO of 1 minutes and… RPO of 15 minutes" |
| Email | Nishant, 8 Nov 2025 00:03, K4.3 | Original: "RTO of ≤1 minutes" |
| Compliance | Rows 145–148 | J4.3 and J4.4 missing |
| Email | Navjeet, 25 Nov 2025 03:41 | "portal to be on one site only" |
| Proposal | Architecture Traceability → HA and Cross-Data-Centre Continuity | "designed to support… subject to Bank-provided network…" |
| Proposal | Assumptions table → "RTO/RPO" | "validated through implementation-stage HA/DR testing" |
| Email | Navjeet, 28 Jul 2026 09:19, item 7 | Component vs complete DC loss? |
| Workbook | SBI Query Sheet row 6 (SI 2) | Suggests separate component/site RTOs |
| Gantt | Rows 18, 19, 22 | DR replication, HA/DR controller + fencing, RTO/RPO drills |

**Explained:**
- RTO 1 min = portal usable again within 1 minute. RPO 15 min = at most 15 min of portal data lost. Portal only – DNS keeps resolving on F5.
- **Reading A (one VM/DB node fails, DC alive):** LB skips dead node, local DB standby takes over. 1 min realistic. One site, ~4–6 VMs.
- **Reading B (whole DC lost):** detect → fence old DC (avoid split-brain / double execution) → promote DR DB → start DR scheduler → reconcile in-flight changes → GSLB moves users. Hard to guarantee in 60 s. 8 VMs, inter-DC network, fencing API, GSLB, DR drills.
- RPO is easy in both cases (replication lag = seconds).
- v2.0 already assumes B. Best ask: two numbers – 1 min component RTO, longer agreed site RTO.

## Q4. TLS 1.3 vs 1.2

Current requirement **is TLS 1.3 or higher**. The 1.2 is a deviation F5 wants to request – not accepted.

| When | Source | What it says |
|---|---|---|
| 8 Nov 2025 | Email, Nishant, K3.5 | "TLS 1.2 or higher" (old) |
| 2026 | RFP p.75, J3.5 | "TLS 1.3 or higher, and encryption of sensitive DNS data at rest" (current) |
| Bid | Compliance C142 = N, D142 | "Maximum of TLS 1.2… for management portal and iRest Control API" |
| 28 Jul 2026 09:19 | Email, Navjeet, change 2 + item 8 | Needs end-to-end uplift; asks F5 to confirm |
| 28 Jul 2026 14:18 | Email, Abhishek | Query: "minimum of TLS 1.2 for front-end portal" |
| 29 Jul 2026 | Workbook SBI Query row 5 (SI 1); F5 Internal row 16 (F11); Overview C8 | Open |
| — | Proposal → Presentation Layer, bullet 2 | "Terminates or passes through TLS 1.3" (contradicts D142) |

Per leg: browser → portal = covered, Azalio controls, do 1.3-only. Portal → F5 = covered, problem leg (1.2 only per D142). Portal → IdP/ITSM/SIEM = not named in J3.5, unknown. Internal hops = not named.
Note: "1.3 or higher" means 1.2 must be off on covered legs. Encryption at rest (same clause) is undesigned.

## Q5. ITSM product and depth

| Doc | Location | What it says |
|---|---|---|
| RFP | p.75, J2.3 | "integrated with Bank's ITSM solution for proper change and incident management" |
| Compliance | B68 (F21) | "ITSM platform (such as BMC)" |
| Compliance | C136 (J2.3) | Y, no remark |
| Compliance | B10 (A8) | ITSM in list of Bank systems |
| Proposal | Scope → In Scope → Integration bullet 4 | "ticket correlation, status validation/workflow gating where applicable…" |
| Proposal | Integration Layer → ITSM Tool | "…as defined during detailed design" |
| Email | Navjeet, 28 Jul 2026 09:19, item 6 | Earlier = ticket reference only; 5 candidate flows |
| Workbook | SBI Query Sheet row 7 (SI 3) | Open |
| Gantt | Row 13 | ITSM Integration W9–W12 |

Levels: 0 store ticket number · 1 check ticket approved · 2 write result back · 3 raise incident on failure · 4 create ticket itself.

## Q6. Sizing

| Doc | Location | What it says |
|---|---|---|
| RFP | p.75, J1.10 | Scalable for growth – no numbers |
| Compliance | B41 (E1) | 500 zones min, 1 lakh records each min |
| Compliance | B45 (E5) | 200 simultaneous record updates min |
| Compliance | B12 (A10) | 6 lakh endpoints |
| Proposal | Infrastructure Dimensioning intro | "Final sizing will be validated during HLD against… DNS inventory… audit-retention" |
| Proposal | Executive Summary bullet 4 | "…for the next 7 years" |
| Email | Ganesh 17 Nov 2025 14:42; Tanmay 19 Nov 2025 10:51 | Old 3+3 sizing, 1 TB DB |
| Workbook | SBI Query Sheet row 12 (SI 8) | Open |

500 × 1,00,000 = 5 crore records = F5 capacity, not SBI actual data. Design UI and sync for large volumes.

## Other open items (not raised in the workbook yet)

- Compliance A8 (row 10): NMS, PIMS, IDAM, LMS, NTP, SCGuard integrations for the portal?
- Compliance A9 (row 11): NTPv4 + SHA-2 on portal VMs?
- Compliance A11 (row 13): PQC readiness for the portal?
- Compliance rows 145–148: add J4.3 and J4.4.
- J3.5 encryption at rest – mechanism.
- Audit retention period.
- Compliance A3 (row 5): UAT at Primary Site?

## Azalio internal decisions

Patroni DCS/witness location · Vault/KMS at DR · full request state model · partial-failure behaviour · rollback · drift policy · notifications · bulk import · service/API identity auth · auditor role · monitoring stack · Crunchy vs community Postgres · update Figure 1 · renumber K → J.
