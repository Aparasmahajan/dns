# SBI DNS Front-End Portal – Requirements Questionnaire

Date: 27 Oct 2026 · Prepared by: Azalio Technologies

## How to use this questionnaire

We need these answers to finalise the design of the DNS Front-End Portal (RFP Section J). Please type answers in the **Answer** column, or attach files using the data templates in Section 12.

Where we already have a sensible default, it is shown under **Our proposal**. If it works for you, just write "Agreed".

| Who answers | Sections |
| --- | --- |
| SBI (DNS, IT security, infra, ITSM and SIEM teams) | 1–7, 10–12 |
| Starlight (load balancer maintenance) and SBI | 8 |
| F5 | 9 |

Questions are numbered (U1, D5, …) so answers can be referenced in calls and emails.

---

## 1. Users, roles and access

This decides who can log in, what each person can do, and how new people get access. Proposed roles: **Requester** (raises changes), **Approver** (checks and approves), **Admin** (manages the portal), **Auditor** (read-only view of history).

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| U1 | Are the four roles above enough? Do you need any other role (e.g. Department Head, Security Reviewer, Read-only Viewer)? | Four roles as above | |
| U2 | Roughly how many people per role at go-live? How many in 3 years? | — | |
| U3 | How many portal Admins? Should Admin rights be split (e.g. user admin vs. configuration admin)? | 2–4 admins, split into User Admin and System Admin | |
| U4 | How should a new person get access? | Bank IT adds the person to an AD group; the portal gives the matching role automatically at first login | |
| U5 | Who approves giving someone portal access? Is there an existing access-request process (form, ITSM ticket, IDAM/PIMS tool)? | Use the Bank's existing access process | |
| U6 | When someone leaves or changes department, how is access removed? Is removal from the AD group enough? | AD group removal removes access at next login | |
| U7 | Please share the AD group names to use, or confirm we should propose a naming scheme. | We propose names; Bank creates groups | |
| U8 | Can one person be a requester and an approver on different requests? (Nobody can approve their own request.) | Yes, but never for their own request | |
| U9 | Should access be limited by department / application / zone (e.g. Retail team can only change Retail records)? | Yes, every user is limited to their assigned groups | |
| U10 | When an approver is on leave, can approval be delegated to someone else? | Yes, time-bound delegation set by Admin | |
| U11 | Which MFA method does the Bank use (OTP app, SMS, hardware token)? Is login via SAML or OIDC? | Use the Bank IdP as-is | |
| U12 | Will other systems (scripts, automation tools) need to call the portal API? If yes, which? | Separate service accounts with limited rights | |
| U13 | How often should user access be reviewed? Do you need an access-review report? | Quarterly access report | |

## 2. DNS scope and data

This decides what the portal manages and how big it needs to be. A **zone** is a domain the Bank owns (e.g. *sbi*); a **record** is one entry inside it (e.g. *mail.sbi → 10.1.1.5*).

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| D1 | How many zones does the Bank have today, and how many records in total? Expected numbers in 7 years? | — | |
| D2 | Please share the list of zones (template T2). | — | |
| D3 | Which record types are used? | A, AAAA, CNAME, MX, TXT, PTR, NS, SRV, CAA, DS | |
| D4 | Should the portal manage **only DNS records**, or also F5 traffic objects such as Wide IPs, pools, monitors and topology rules? | DNS records only | |
| D5 | Should the portal create and delete **zones**, or only records inside existing zones? | Records only; zones created by DNS admins on F5 | |
| D6 | Are reverse (PTR) zones in scope? | PTR records yes; reverse zone creation no | |
| D7 | How should records be grouped – by department, application, location, environment? Please share the list (template T3). | Department + Application + Location | |
| D8 | Does the Bank already have a record of who owns which zone/record (CMDB, Excel)? Can you share it? | We import it at go-live | |
| D9 | Records with no known owner – who should they be assigned to? | A default "Unassigned" group owned by DNS Admins | |
| D10 | TTL rules: minimum, maximum and default TTL? Different rules per zone? | Min 60 s, max 86400 s, default 3600 s | |
| D11 | Naming rules: any Bank standard for hostnames (allowed characters, prefixes, length)? | Standard DNS rules only | |
| D12 | Are there records nobody may change from the portal (e.g. NS, SOA, critical banking names)? | Admin-only "protected" list | |
| D13 | If someone changes a record directly on F5 (outside the portal), what should happen? | Portal flags it and alerts Admins; no auto-revert | |
| D14 | How often should the portal re-check F5 for changes? | Every 15 minutes + on demand | |
| D15 | Is existing DNS data being moved from an old system into F5? If yes, who does it and when will F5 be ready for us to read? | Migration by F5; portal imports after migration | |

## 3. Change workflow (maker–checker)

This decides the steps a DNS change goes through, from request to execution on F5.

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| W1 | How many approval levels? Same for all changes, or more levels for risky ones (delete, critical zones, production)? | 1 level normally; 2 levels for deletes and critical zones | |
| W2 | Who approves – the department's approver, the central DNS team, or both? Please fill template T4. | Department approver, then DNS team for critical zones | |
| W3 | Is an emergency / urgent change path needed (e.g. outage fix at night)? Who approves it? | Yes; one senior approver, reviewed after the fact | |
| W4 | Are there fixed change windows or freeze periods (e.g. month-end, festivals)? | Admin-configurable blackout calendar | |
| W5 | How long can a request wait for approval before it expires? | 7 days | |
| W6 | Should changes be applied to DC, DR and AZ together, or can the requester choose sites? | All sites together by default | |
| W7 | If a change succeeds at one site but fails at another, what should happen? | Mark "Partially applied", alert Admin, allow retry or undo | |
| W8 | Is "undo / roll back" of an applied change needed? Who can trigger it? | Yes, as a new request that also needs approval | |
| W9 | Is bulk change needed (e.g. upload an Excel/CSV of 500 records)? Maximum batch size? | Yes, up to 1,000 records per upload | |
| W10 | How should approvers and requesters be notified? | Email + in-portal notification | |
| W11 | Please share the Bank's SMTP / email gateway details for portal emails. | — | |
| W12 | Can a requester edit or cancel a request after submitting it? | Edit/cancel only before approval | |
| W13 | Any other approval steps you need that are not listed here? | — | |

## 4. ITSM (change and incident tickets)

This decides how the portal works with the Bank's ticketing tool.

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| IT1 | Which ITSM product and version does the Bank use (e.g. BMC Remedy / Helix, ServiceNow)? | — | |
| IT2 | Must every DNS change have an approved change ticket, or only some (e.g. production, critical zones)? | Required for production changes | |
| IT3 | Which of these should the portal do? (a) store the ticket number typed by the user, (b) check the ticket is approved before executing, (c) update the ticket with the result, (d) raise an incident if a change fails, (e) create the change ticket itself | (a) + (b) + (c) + (d) | |
| IT4 | If the ticket is already approved in ITSM, is portal approval still needed? | Yes – ITSM = business/CAB approval, portal = technical check | |
| IT5 | Which ticket fields must the portal read or fill (category, CI, assignment group, etc.)? | — | |
| IT6 | API details: REST or other, login method (token, OAuth, basic), and is a test/UAT ITSM instance available? | — | |
| IT7 | If ITSM is down, should DNS changes be blocked or allowed and synced later? | Blocked, except emergency changes | |
| IT8 | Which assignment group should portal-raised incidents go to? | — | |

## 5. Dashboards and reports

This decides what people see on the home page and which reports they can download.

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| R1 | What should each role see on the home page? | Records per department, pending approvals, my requests, recent failures | |
| R2 | Which reports are needed? Please fill template T5. | Records by department/group, request & approval status, scheduled changes, execution results, audit/compliance, user access | |
| R3 | Export formats? | PDF, Excel, CSV | |
| R4 | Should any report be emailed automatically? To whom, how often? | Weekly summary to DNS Admins | |
| R5 | Who can see which reports – own department only, or all? | Own scope only; Admin and Auditor see all | |
| R6 | F5 traffic analytics (queries per second, top domains, device health) – stay in F5 BIG-IQ, or must they appear inside the portal? | Stay in BIG-IQ; portal shows a link | |
| R7 | How long must request and audit history be kept and searchable? | 7 years (last 1 year online, older archived) | |

## 6. Security, audit and compliance

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| S1 | The RFP asks for TLS 1.3 or higher. F5's management API currently supports TLS 1.2. Can the Bank accept TLS 1.2 for the portal-to-F5 connection, with TLS 1.3 everywhere else? | As described | |
| S2 | Do the Bank's IdP, ITSM and SIEM support TLS 1.3? | — | |
| S3 | Encryption of stored data: what is the Bank standard (storage/VM encryption by private cloud, database encryption, both)? | Storage encryption by Bank + database encryption for sensitive fields | |
| S4 | SIEM product, log format (Syslog / CEF / JSON) and collector address? | — | |
| S5 | Which events must go to SIEM? | Logins, requests, approvals, executions, failures, admin changes | |
| S6 | Does the Bank have a Vault / KMS / HSM for storing passwords and keys? Is it available at both DC and DR? | Use Bank's existing one | |
| S7 | Will the Bank PKI issue the portal's SSL certificates? Lead time? | — | |
| S8 | How should admins log in to portal servers – via PIMS / PAM tool or a jump server? Which tool? | Bank PIMS + jump server | |
| S9 | Session rules: idle timeout, one login at a time? | 15 min idle timeout; one active session per user | |
| S10 | Please share the Bank IS policy and server hardening standards to follow. | — | |
| S11 | VAPT: who performs it, and is it required before go-live? | Bank-appointed auditor, before go-live | |
| S12 | Does the RFP's Post-Quantum Cryptography (PQC) readiness clause apply to the portal? | — | |
| S13 | Should the portal be reachable only from the Bank network / specific IP ranges? | Bank internal network only | |

## 7. Infrastructure and availability

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| N1 | The RFP asks for a 1-minute recovery time (RTO). Does this apply to one server failing inside a data centre, or to a whole data centre going down? | 1 minute for a server failure; a separate agreed time for a full data-centre loss | |
| N2 | Which data centres will host the portal (DC and DR names/locations)? | DC (active) + DR (standby) | |
| N3 | VM platform: which private cloud / hypervisor, which OS image (RHEL 9?), who installs the OS, and lead time for VMs? | RHEL 9 VMs from Bank | |
| N4 | Network between DC and DR: bandwidth and latency available for database copying? | — | |
| N5 | During a DR switch-over the portal must safely switch off the failed DC copy. Can the Bank give API access (limited to portal VMs only) to power off or isolate them? | Yes, limited service account | |
| N6 | Backup: which Bank backup tool, where are backups stored, how long are they kept? | Daily backup to Bank backup system | |
| N7 | Bank NTP server addresses? (RFP asks for NTPv4 with SHA-2 authentication.) | — | |
| N8 | Should portal servers be monitored by the Bank's NMS tool? Which tool – SNMP or agent? | Yes | |
| N9 | UAT environment: where (primary site?), same size as production or smaller? Will a test F5 (BIG-IP VE) be available for UAT? | Smaller UAT at primary site with a test F5 | |
| N10 | Firewall-rule request process and lead time? | — | |
| N11 | Monthly patching windows? (RFP requires critical patches within 72 hours.) | — | |
| N12 | Do servers get updates from an internal repository, or is internet access allowed? | Internal repository | |

## 8. Load balancer and portal URL (Starlight + SBI)

The portal will sit behind the Bank's load balancer, so users get one web address that automatically moves to DR if DC fails.

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| L1 | (SBI) What should the portal web address be (e.g. dnsportal.sbi)? | — | |
| L2 | Which load-balancer product and version is in use? | — | |
| L3 | Can Starlight provide a VIP for the portal at each site (DC and DR)? | Yes, one VIP per site | |
| L4 | Can a global VIP / GSLB give one address that switches to DR automatically? | Yes | |
| L5 | We will provide a health-check page that returns "ready" only on the active site. Can the load balancer use it? What check interval? | Check every 5 seconds | |
| L6 | Where is SSL ended – on the load balancer or on the portal servers? Which TLS versions and ciphers does the load balancer support? | Ended on load balancer, re-encrypted to portal | |
| L7 | Is WAF, rate limiting or DDoS protection available on the VIP? (RFP J3.6) | Yes, use existing WAF | |
| L8 | Can the load balancer pass the user's real IP address to the portal (X-Forwarded-For) for audit logs? | Yes | |
| L9 | Sticky sessions are not needed (portal servers are stateless) – please confirm. | Not needed | |
| L10 | Change process and lead time for load-balancer configuration? Contact person at Starlight? | — | |

## 9. F5 integration (F5)

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| F1 | Should the portal connect to BIG-IQ (central) or directly to each BIG-IP at DC, DR and AZ? | — | |
| F2 | BIG-IP and BIG-IQ software versions to be deployed? | — | |
| F3 | How are DNS changes copied between DC, DR and AZ on the F5 side? Should the portal push to every site, or to one site and let F5 sync? | — | |
| F4 | API service account: limited to DNS objects only, login method (token)? | Dedicated limited account | |
| F5 | Which F5 partitions / zones will the portal be allowed to access? | — | |
| F6 | Will a test F5 (BIG-IP VE / BIG-IQ) be available for development and testing? From when? | — | |
| F7 | Please share official API documentation and the supported list of DNS objects for the chosen versions. | — | |
| F8 | Any API limits (calls per second, concurrent sessions)? | — | |
| F9 | Do BIG-IP / BIG-IQ APIs support TLS 1.3 in the chosen versions? | — | |

## 10. Portal look and usage

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| P1 | Branding: we will use the F5 logo for now. Should the final portal use the SBI logo and colours? Any SBI UI guidelines? | F5 logo for now | |
| P2 | Portal name to show in the header? | "DNS Management Portal" | |
| P3 | Which browsers and versions must be supported? | Latest Chrome and Edge | |
| P4 | Language: English only, or Hindi too? | English only | |
| P5 | Desktop only, or tablets too? (Mobile apps are not in scope.) | Desktop and laptop | |
| P6 | How many people may use the portal at the same time at peak? | — | |
| P7 | Time zone for schedules and reports? | IST | |
| P8 | Any accessibility requirements? | — | |

## 11. Support, training and go-live

| # | Question | Our proposal | Answer |
| --- | --- | --- | --- |
| SP1 | Support severity levels and expected response/fix times? | — | |
| SP2 | How should the Bank raise issues – ITSM queue, email, phone? | Bank ITSM queue + phone for P1 | |
| SP3 | Is onsite support needed? Which locations, how long? | — | |
| SP4 | Training: how many batches and people, where? Separate admin and user training? | 2 user batches + 1 admin batch | |
| SP5 | Documents needed (user manual, admin guide, runbooks, API guide)? Any Bank templates? | All four | |
| SP6 | Go-live: all departments at once, or in phases? | Pilot department first, then all | |
| SP7 | Target project start and go-live dates? | — | |
| SP8 | Single point of contact at SBI, F5 and Starlight? | — | |

## 12. Data templates to fill

Please share these as Excel/CSV. Column names are below.

**T1 – Roles and AD groups**

| AD group name | Portal role | Department / scope | Group owner | No. of members |
| --- | --- | --- | --- | --- |

**T2 – Zones**

| Zone name | Forward / Reverse | Approx. record count | Owning department | Criticality (High/Med/Low) | Environment (Prod/UAT) | Notes |
| --- | --- | --- | --- | --- | --- | --- |

**T3 – Logical groups**

| Group type (Department / Application / Location / Environment) | Group name | Parent group | Owner | Approver AD group |
| --- | --- | --- | --- | --- |

**T4 – Approval matrix**

| Change type (Create / Modify / Delete) | Zone or criticality | Level 1 approver group | Level 2 approver group | ITSM ticket required (Y/N) |
| --- | --- | --- | --- | --- |

**T5 – Reports wishlist**

| Report name | Purpose | Who uses it | Frequency | Format | Filters needed |
| --- | --- | --- | --- | --- | --- |

**T6 – Sample record export** (a few hundred rows from the current DNS, if available)

| Zone | Name | Type | Value | TTL | Owner / department |
| --- | --- | --- | --- | --- | --- |
