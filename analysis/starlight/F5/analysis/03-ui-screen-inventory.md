# SBI DNS Portal – UI Screen Inventory

Date: 27 Oct 2026, **updated 04 Nov 2026 for Proposal v2.2** (local login + LDAP, Read / Write / Checker access levels, Checker and Admin direct changes, versioning and rollback, F5 error per site). Derived from functional requirements; the documents contain no wireframes, field lists or style guide.

## Users and login

- **One Admin** (credentials in config). **Local users** are created by the Admin. **Bank LDAP users** are validated against the Bank LDAP/directory API if they aren't in the local DB.
- Access levels (v2.2): **Read** (view all groups, no group assignment), **Write** (maker: view and create/modify/delete requests, now or scheduled, only in Admin-assigned groups; requests need approval), **Checker** (always Read + Write on all groups; approve/reject Write requests; own changes run directly without approval). The **Admin** is a Checker plus admin functions; Admin changes and rollbacks also run without approval.
- **Portal login page** with username + password. No SSO redirect and no MFA.
- Branding: F5 logo for now (SBI branding to confirm – questionnaire P1).
- Stack: React (TypeScript) in the proposal; Next.js in the LLD – to be decided.

## Screens

| # | Screen | Who | Source |
|---|---|---|---|
| 1 | **Login** – username/password, generic error, locked-account message, first-login password change for local users | All | v2.2 §5.5 |
| 2 | **Pending access** – "your account is awaiting access from the Admin" page for first-time LDAP users | LDAP users | v2.2 §5.5 |
| 3 | Dashboard – records per department/group, pending approvals, request status, execution success/failure | All (scoped) | J1.11, Compliance D132 |
| 4 | DNS record inventory – search, list, filter by zone / group, sync status, **version number column** | Read+ | J1.5, J1.6 |
| 5 | Create / modify / delete record form – inline validation (duplicate, CNAME loop, TTL, name/IP), target sites DC/DR/AZ, **run now or schedule**; for a Checker / Admin the change runs directly (no approval) | Write, Checker, Admin | J1.7, J1.8, v2.2 §5.5 |
| 6 | My requests – list with status; modify/cancel own pending or scheduled requests | Write, Checker, Admin | Proposal Figure 4 |
| 7 | **Checker inbox** – requests raised by Write users in all groups, approve / reject with comment | Checker, Admin | v2.2 §5.5 |
| 8 | Request detail – timeline, approvals (or "direct change"), per-site result (DC/DR/AZ), resulting version; **on failure, the F5 error code and message per site exactly as returned by F5** (shown to the maker, Checkers and Admin) | All (scoped) | Figure 4, v2.2 §5.5 |
| 9 | Scheduled changes and scheduled rollbacks | Write, Checker, Admin | J1.8c |
| 10 | **Record version history** – list of versions (1.0, 1.1 …) with maker, approver (blank for direct changes), date, reason | Read+ | v2.2 §5.5 |
| 11 | **Version compare** – side-by-side diff of any two versions, or a version vs live F5 config | Admin | v2.2 §5.5 |
| 12 | **Rollback** – pick target version, review diff, run now or schedule, reason + ITSM ref | Admin | v2.2 §5.5 |
| 13 | **User management** – create local user (temp password), enable/disable, unlock, reset password | Admin | J1.3 |
| 14 | **Pending users queue** – first-time LDAP users awaiting mapping | Admin | v2.2 §5.5 |
| 15 | **Permission mapping** – per user: pick one level (Read / Read and Write / Checker); group selection only for Read and Write (Read and Checker are always all groups) | Admin | J1.3, J1.6, J1.8, v2.2 §5.5 |
| 16 | **DNS groups and record ownership** – create/edit groups, assign or reassign records, Unassigned records list | Admin | J1.4, D125 |
| 17 | Service / API keys | Admin | D124 |
| 18 | Workflow configuration (levels per group, change windows) | Admin | J1.9 |
| 19 | Validation rules / TTL policies | Admin | Proposal Data layer |
| 20 | Sync and drift – out-of-band changes | Admin | J1.5, D126 |
| 21 | Audit log viewer | Admin (and Read users, if the Bank wants) | J3.1 |
| 22 | Reports – by department/group, approvals, scheduled, execution results, rollbacks, compliance | All (scoped) | J1.11, D132 |
| 23 | Admin settings – F5, LDAP, ITSM, SIEM endpoints and health | Admin | Proposal Data layer |

Removed since 27 Oct: SSO redirect, "AD group → role" access screen (replaced by 13–16).

Record types for the form: A, AAAA, CNAME, TXT, MX, NS, PTR, SRV, CAA, DS (final list depends on the F5 API docs and the Bank's form fields).
Request states: draft, pending approval, approved, scheduled, executing, executed, partially applied, failed, rejected, cancelled, rolled back.

## Open items that affect the UI

| Open question | UI impact |
|---|---|
| Object scope and F5 API (records only vs Wide IPs, pools…) | Large – form fields come from the F5 API docs; design for records first, leave room in navigation |
| ITSM depth | Medium – ticket field, "awaiting ITSM approval" state, incident links |
| LDAP attributes returned | Small – which profile fields show on the pending-users queue |
| BIG-IQ vs BIG-IP | Small–medium – per-device results vs one BIG-IQ job on request detail |
| Sizing (up to 5 crore records) | Medium – server-side search, pagination, zone-first navigation |
| Password policy (local users) | Small – rules shown on the change-password screen |
| Not in docs | Branding, browsers, accessibility, language, notifications, bulk upload (all in questionnaire) |
