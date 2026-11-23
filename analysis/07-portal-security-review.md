# DNS Management Portal: security review

| | |
|---|---|
| Date | 06-Nov-2026 |
| Scope | `portal/` at commit `f37c6ad` (branch `addn` of `paras-azalio/dns`) |
| Method | Source and configuration review of the whole backend, schema, NGINX, Docker and Fluent Bit setup and the frontend API layer; `npm audit`; library versions read from the built image `dns-portal/backend:0.1.0` (05-Nov-2026). **Not a penetration test.** |
| Classification | **Internal, Starlight only.** This lists open weaknesses: do not share it outside the project team or push it to a public repository. |

Paths below are relative to `portal/`.

## 1. Summary

The application code is in good shape for a first increment. The review found **no SQL injection, cross-site
scripting (XSS), cross-site request forgery (CSRF) or broken object-level access (IDOR)**: every query is
parameterised, partition scoping is applied inside the database queries, CSRF uses a double-submit token with
SameSite=Strict cookies, and the React UI never injects HTML.

What the Bank's IS team, auditors and VAPT will flag is mostly around the code:

1. **Privileged access (SEC-01 to 03).** There is no MFA, the one Admin password sits in `.env`, and any single
   Checker can change any DNS record with no second person. These come from proposal v2.2 decisions, so they need
   a Bank decision and not only code.
2. **Audit trail integrity (SEC-05, 06).** The portal's own database account can empty the audit trail, and any
   user can forge the client IP that gets recorded.
3. **Patching (SEC-04).** Backend and frontend libraries have published CVEs, and Spring Boot 3.4 no longer gets
   open-source fixes.
4. **Hardening (SEC-07 to 12).** Sessions never time out while a tab is open, anyone can lock out the only Admin,
   TLS is not end-to-end, and secrets live in `.env`.

| Severity | Count | When |
|---|---|---|
| High | 5 | Fix, or get a Bank decision, before UAT |
| Medium | 10 | Fix before UAT / go-live |
| Low | 7 | Hardening during the build |

**Fix first:** SEC-04 (upgrade and scan), SEC-05 (separate DB roles, real append-only audit), SEC-06 (stop
trusting client `X-Forwarded-For`), SEC-07 (real session timeouts), SEC-08/09 (login throttling that cannot lock
out the Admin). In parallel, raise SEC-01 to 03 with the Bank (via F5).

## 2. Findings at a glance

| ID | Severity | Finding | Fix type |
|---|---|---|---|
| SEC-01 | High | No MFA for any user, including Checkers and the Admin | Bank decision + code |
| SEC-02 | High | One shared Admin credential with unrestricted power; no segregation of duties | Bank decision + code |
| SEC-03 | High | Any Checker (or the Admin) can change any DNS record alone | Bank decision + code |
| SEC-04 | High | Libraries and images with published CVEs; no scanning in the build | Code |
| SEC-05 | High | Audit trail and record history can be altered by the app's own DB account; SIEM not connected | Code + DB |
| SEC-06 | Medium | Client IP in audit/access logs can be forged; login rate limit becomes global behind a SNAT VIP | Config |
| SEC-07 | Medium | Sessions never expire while a tab is open; no absolute lifetime; password reset does not end sessions | Code |
| SEC-08 | Medium | Anyone can lock any account, including the only Admin; lock state shown before the password check | Code |
| SEC-09 | Medium | Unlimited password guessing for directory users not yet in the portal; any employee can create a profile | Code + config |
| SEC-10 | Medium | Partitions do not own DNS names or IP ranges | Code + Bank input |
| SEC-11 | Medium | TLS not end-to-end; cleartext LDAP accepted; no runtime trust store for the Bank CA | Config + infra |
| SEC-12 | Medium | Secrets in `.env` and container environment; LDAP bind as the directory administrator | Config + infra |
| SEC-13 | Medium | No dormant-account, leaver or access-review controls; local accounts not tied to a real employee | Code + Bank policy |
| SEC-14 | Medium | Only the Admin, the most privileged user, can read the audit trail | Code + Bank decision |
| SEC-15 | Medium | No automated tests or security scans in the build | Process |
| SEC-16 | Low | A maker's partition rights are not re-checked when an approved change runs | Code |
| SEC-17 | Low | Version, site role, LDAP URL and DB version shown to unauthenticated or low-privileged users | Code |
| SEC-18 | Low | Insecure defaults (cookie Secure off, sample data in any environment, password on the command line) | Code |
| SEC-19 | Low | Password rules: 128-character limit vs bcrypt's 72 bytes, no history, no common-password check | Code |
| SEC-20 | Low | Sign-in ID not validated; very long IDs make the failed-sign-in audit fail | Code |
| SEC-21 | Low | Browser and cookie hardening (HSTS, `__Host-` cookie, Secure CSRF cookie, CSP) | Config |
| SEC-22 | Low | Container hardening (root NGINX, unpinned images, writable root FS, audit-log size cap, NTP) | Config |

## 3. Findings

### SEC-01 · High · No MFA

- **Where:** the whole sign-in (`auth/AuthService.java`). MFA was taken out of scope on 03-Nov-2026 (proposal v2.2).
- **Issue:** every account signs in with one factor. Directory users, which includes most Checkers, use their Bank
  directory password, which also opens their mail and VPN and is the usual phishing target.
- **Impact:** one phished Checker password is enough to change any DNS record of the Bank directly (SEC-03), for
  example to point an internet-banking name at a phishing server.
- **Standards:** RFP J1.2 (MFA for all users); OWASP ASVS V4.3.1 (MFA for administrative interfaces); RBI Cyber
  Security Framework, user access control (MFA for privileged access); ISO 27001 A.8.5.
- **Fix:** ask the Bank to reverse "no MFA" at least for Checker and Admin. Options: the Bank's existing OTP/2FA
  service, TOTP (RFC 6238) enrolled per user, or FIDO2/WebAuthn. Also add step-up re-authentication before approve,
  direct change, rollback and access grants (ASVS V3.7.1).

### SEC-02 · High · One shared Admin credential, no segregation of duties

- **Where:** `config/AdminBootstrap.java`, `ADMIN_PASSWORD_HASH` in `.env`, `ux_portal_user_single_admin` in
  `backend/src/main/resources/db/migration/V1__init.sql:43`.
- **Issue:** the Admin is one configuration account. Whoever knows the password manages users and partitions, makes
  DNS changes and rollbacks with no approval, and is the only person who can read the audit trail (SEC-14). The
  password never expires, is not checked against the password policy (only the hash format is), and every action is
  recorded as `admin`, not as a named person.
- **Impact:** no individual accountability and no segregation of duties; a compromise gives full control.
- **Standards:** ISO 27001 A.5.3 (segregation of duties), A.8.2 (privileged access); RBI user access control
  (accountability of privileged users); ASVS V4.3.1.
- **Fix (needs a Bank decision):**
  - keep one break-glass Admin, vaulted in the Bank's PAM tool with check-out, rotation and session recording; or
  - use named Admin accounts (a Bank LDAP group) with MFA.
  - In both cases, split user administration from DNS operations, or have a second person approve access grants
    (at least a daily review of access changes by IS).

### SEC-03 · High · Single-person DNS changes

- **Where:** `change/ChangeRequestService.java:211` (`setDirect(me.isChecker())`) and `:222-224` (runs at once);
  rollbacks at `:418-449`.
- **Issue:** Checker and Admin changes skip approval, as proposal v2.2 decided. Nothing limits this by partition or
  by how critical a record is: any Checker can change or delete any record in any partition, alone.
- **Impact:** an insider or a compromised Checker can redirect critical names with no second person involved.
  `context.md` already notes that this goes beyond the RFP's maker-checker wording (J1.8).
- **Standards:** RFP J1.8; RBI change management (maker-checker); ISO 27001 A.8.32, A.5.3.
- **Fix (needs a Bank decision):**
  1. four-eyes for every production change (a Checker's change needs another Checker); or
  2. four-eyes only for records or zones flagged critical (internet banking, UPI, mail and so on); or
  3. if the Bank accepts direct changes, compensating controls: MFA step-up on each change, a real-time SIEM alert on
     every `DIRECT_CHANGE_APPLIED` and `ROLLBACK_APPLIED`, and a daily direct-change report signed off by a second
     person.

### SEC-04 · High · Outdated libraries and images

- **Where:** `backend/pom.xml:10`, `frontend/package.json`, `frontend/Dockerfile:4,16`, `docker-compose.yml:130`.
- **Found:**

  | Component | In use | Issue |
  |---|---|---|
  | Spring Boot | 3.4.1 (Dec 2024) | The 3.4 line no longer gets open-source fixes. It pulls in the old versions below. |
  | Spring Security | 6.4.2 | CVE-2025-22228: `BCryptPasswordEncoder.matches` accepts a password that matches only in the first 72 bytes (fixed in 6.4.4). |
  | Tomcat (embedded) | 10.1.34 | CVE-2025-24813 (partial PUT: not exploitable with Tomcat's default read-only servlet, but scanners rate it critical) and later fixes, e.g. multipart request DoS. |
  | Logback | 1.5.12 | CVE-2024-12798, CVE-2024-12801 (fixed in 1.5.13; need write access to the configuration). |
  | PostgreSQL JDBC | 42.7.4 | CVE-2025-49146 (channel-binding downgrade; fixed in 42.7.7). |
  | react-router-dom | 6.28.0 | `npm audit`: 3 high in production dependencies (GHSA-2w69-qvjg-hvjx XSS via open redirects, GHSA-2j2x-hqr9-3h42 open redirect via `//` paths). Probably not reachable in this app, but scanners will flag it. |
  | vite / esbuild | 5.4.11 | `npm audit`: 1 high, 1 moderate. Dev server only, not in the production bundle. |
  | NGINX image | `nginx:1.27-alpine` = NGINX 1.27.5 on Alpine 3.21.3 | The 1.27 line ended in 2025 and Alpine 3.21 support ends in Nov 2026, so this tag gets no more fixes. |
  | Fluent Bit image | 3.1.9 (Sep 2024) | Two years old; later security fixes are in the 4.x line. |

  The build also skips checks (`npm ci --no-audit` in `frontend/Dockerfile:11`, `-DskipTests` in
  `backend/Dockerfile:15`) and nothing scans the images. The list above is indicative; run the scanners below for
  the full list. Good news: the Java runtime (Temurin 21.0.13 on Ubuntu 26.04.1) and PostgreSQL 16.15 images are current.
- **Standards:** RFP J3 (patches) and J4.4 (critical patches within 72 hours); RBI patch and vulnerability
  management; ASVS V14.2.1; ISO 27001 A.8.8.
- **Fix:**
  1. Move to the latest Spring Boot release on a line that still gets open-source security fixes (check the
     support dates on spring.io). That updates Tomcat, Spring Security, Logback and the JDBC driver together. Then
     cap passwords at 72 bytes (SEC-19), because newer Spring Security rejects longer ones.
  2. `react-router-dom` to the latest 6.30.x (npm audit suggests 6.30.6); `vite` to a current release.
  3. NGINX: a current stable image (for example `nginxinc/nginx-unprivileged` on a supported Alpine). Fluent Bit:
     current 4.x.
  4. Pin images by digest. In CI: OWASP Dependency-Check (or Trivy) for Maven, `npm audit --omit=dev`, and a Trivy
     image scan, failing on High/Critical. Produce a CycloneDX SBOM per build (the Bank already asked for an SBOM).
  5. Patch monthly, with a 72-hour path for critical CVEs.

### SEC-05 · High · Audit trail and history can be altered

- **Where:** `backend/src/main/resources/db/migration/V1__init.sql:148-156` (trigger), `:118-128` (record versions);
  `application.yml` (one DB account for Flyway and the app); `fluent-bit/fluent-bit.conf:71-75` (stdout only);
  `audit/AuditService.java:93-109`.
- **Issue:**
  - The app connects as the schema owner (README: "This account owns the schema"), and Flyway uses the same account.
    The owner can `TRUNCATE audit_event` (row-level triggers do not fire on TRUNCATE), disable the trigger, or drop
    the table.
  - `dns_record_version` is described as immutable, but nothing prevents UPDATE or DELETE, so the version history
    that rollbacks use can be rewritten.
  - There is no tamper evidence (hash chain or signature). The SIEM copy, which would be the independent copy, is not
    connected yet: Fluent Bit only prints.
  - The SIEM line is written after the commit. If the process stops in between, the database has the event but the
    SIEM never gets it.
- **Impact:** anyone with the DB password from `.env` (host administrators, a copied `.env`) or a future SQL injection
  can erase or rewrite evidence. Auditors treat a deletable audit trail as a major finding.
- **Standards:** RFP J3 (audit trail to SIEM); ASVS V7.3.3; RBI audit log controls; ISO 27001 A.8.15.
- **Fix:**
  1. Two DB roles: an owner used only by Flyway (`spring.flyway.user` / `password`) and an app role with data
     access only.
  2. The app role gets `SELECT, INSERT` only on `audit_event` and `dns_record_version`.
  3. Block TRUNCATE with a statement-level trigger, and protect `dns_record_version` the same way as the audit table.
  4. Add a hash chain (`prev_hash`, `hash` per event) or signed checkpoints, plus a job that verifies them.
  5. Connect Fluent Bit to the SIEM (syslog over TLS or the SOC's collector) before UAT, and alert if shipping stops.
  6. Consider an outbox table for SIEM lines instead of writing them after the commit.

  ```sql
  -- run as the owner; dnsportal_app is the role the backend uses at runtime
  GRANT USAGE ON SCHEMA public TO dnsportal_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dnsportal_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON audit_event, dns_record_version FROM dnsportal_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dnsportal_app;
  -- plus ALTER DEFAULT PRIVILEGES so tables from later migrations get the same grants

  CREATE TRIGGER trg_audit_event_no_truncate
      BEFORE TRUNCATE ON audit_event
      FOR EACH STATEMENT EXECUTE FUNCTION audit_event_is_append_only();
  ```

### SEC-06 · Medium · Client IP can be forged; rate limit becomes global

- **Where:** `frontend/nginx.conf:46,55` (`X-Forwarded-For $proxy_add_x_forwarded_for`), `application.yml:3`
  (`forward-headers-strategy: native`), `audit/AuditService.java:138-143`, `frontend/nginx.conf:4,40`.
- **Issue:**
  - NGINX appends to whatever `X-Forwarded-For` the browser sends. Tomcat, as Spring Boot sets it up, treats every
    private address (10/8, 172.16/12, 192.168/16) as a trusted proxy. Bank desktops have private addresses, so
    Tomcat skips the real one and takes the value the client sent. A user who sends `X-Forwarded-For: 10.9.9.9` gets
    that address stored in `audit_event.client_ip` and the API access log. (NGINX's own log keeps the real address.)
  - Behind an F5 VIP with SNAT, NGINX sees the VIP's address for every user. The login limit (30 per minute per IP)
    then becomes one shared limit, so one script can block sign-in for everyone, and NGINX's log loses the client IP.
- **Standards:** ASVS V7 (log integrity); CERT-In (logs must identify the source).
- **Fix:**

  ```nginx
  # Trust X-Forwarded-For only from the F5 VIP (addresses from the LB team)
  set_real_ip_from  <VIP self / SNAT addresses>;
  real_ip_header    X-Forwarded-For;
  real_ip_recursive on;

  # in both /api locations: replace, never append client input
  proxy_set_header X-Forwarded-For   $remote_addr;
  proxy_set_header X-Forwarded-Proto https;          # TLS ends at the VIP (see SEC-21)
  ```

  Also set `server.tomcat.remoteip.internal-proxies` to the NGINX address(es) only, and make sure the backend port can
  be reached only from NGINX. Add "insert X-Forwarded-For at the VIP" to the LB prerequisites.

### SEC-07 · Medium · Sessions never time out while a tab is open

- **Where:** `frontend/src/components/Layout.tsx:38` (poll every 30 s), `application.yml:23,50` (30-minute idle
  timeout only), `auth/AuthService.java:172-193`, `user/UserAdminService.java:260-276`.
- **Issue:**
  - The menu badges call `/api/dashboard/counters` every 30 seconds. Each call refreshes the session, so the
    30-minute idle timeout never fires while a portal tab is open, even on an unattended desk.
  - There is no absolute lifetime: an active session lasts indefinitely.
  - Changing or resetting a password does not end the user's other sessions (only disabling does, through
    `SessionUserFilter`). After the Admin resets a suspected compromised account, the attacker's session keeps working.
  - There is no limit on sessions per user.
- **Standards:** ASVS V3.3.2 (re-authentication after 30 minutes idle or 12 hours), V3.3.3, V3.3.4. Bank IS policies
  often set 15 minutes for privileged applications.
- **Fix:**
  - Store `loginAt` and `lastActivityAt` in the session. Background calls send a header (for example
    `X-Portal-Background: 1`) and do not update `lastActivityAt`. `SessionUserFilter` ends the session when idle time
    or age passes the limits (Bank policy; for example 15 minutes and 8–12 hours).
  - Show a "you will be signed out in 1 minute" warning in the UI.
  - On password change, password reset, access change and disable, end the user's other sessions with
    `FindByIndexNameSessionRepository` (the principal index is already set at login).
  - Decide with the Bank: one session per user, or a list of active sessions with sign-out.

### SEC-08 · Medium · Anyone can lock out the Admin and every Checker

- **Where:** `auth/AuthService.java:72-77` (lock check before the password), `:155-169`.
- **Issue:** five wrong passwords lock any known account for 15 minutes, and anyone can trigger it. The Admin
  (`admin`, an obvious name) and every Checker can be locked again and again from one browser, so nobody can approve
  or administer. Employee IDs are sequential (140122, 140123 …), which makes a sweep easy. The "locked" message comes
  before the password is checked, so it also confirms which IDs have portal accounts. The counter restarts after
  each lock, which still allows 5 guesses per account every 15 minutes (about 480 a day).
- **Standards:** ASVS V2.2.1 (anti-automation must also resist account lockout attacks); RBI user access control.
- **Fix:**
  - Throttle per account **and** per client IP (after SEC-06), with growing delays instead of a hard lock for the
    Admin. Keep the hard lock for normal users if Bank policy requires it. Alert the SIEM on lockouts and on many
    failures from one IP.
  - Give the same answer for a wrong password and a locked account; keep the real reason in the audit trail.
  - Allow Admin sign-in only from the Bank's admin network or jump hosts (allow-list at the VIP or NGINX).
  - Count failures over a rolling window (for example 24 hours) instead of resetting at each lock.

### SEC-09 · Medium · Password guessing for any Bank directory user

- **Where:** `auth/AuthService.java:117-142` (unknown IDs go straight to LDAP), `auth/LdapDirectory.java:71`
  (filter `(uid={0})` matches every directory user).
- **Issue:** for IDs that are not yet in the portal, failures are not counted, because there is no row to count on.
  The only limit is NGINX's 30 per minute per IP. Anyone can therefore test passwords for any of the Bank's directory
  users through the portal, and a password that works here also works on the user's other Bank systems. If the Bank
  directory locks accounts after a few failures, the same path can lock out staff who never use the portal. Any
  employee who signs in once also gets a portal profile and sees the partition list (SEC-17).
- **Standards:** ASVS V2.2.1; RBI user access control (least privilege).
- **Fix:**
  - Allow directory sign-in only for members of an LDAP group the Bank manages, for example
    `LDAP_USER_FILTER=(&(uid={0})(memberOf=cn=DNS-Portal-Users,ou=groups,...))`. Ask for the group together with the
    other LDAP details.
  - Count failures per submitted ID even when no profile exists (a small table or cache), with the throttling of SEC-08.

### SEC-10 · Medium · Partitions do not own DNS names or IP ranges

- **Where:** `dns/DnsValidator.java` (format checks only), `change/ChangeRequestService.java:176-190` (create checks
  the partition right and global uniqueness only).
- **Issue:** a partition is only a label on a record; it owns no part of the DNS namespace. A Write user of
  `UPI_Payments` can request a new name under the internet-banking domain, or a PTR for any IP, and a Checker can
  create one directly. Names are unique across all partitions, so one team can also take a name another team needs.
- **Impact:** lookalike or rogue names inside critical domains, and unclear ownership. The F5 partition mapping (open
  point F3) will need this anyway.
- **Standards:** OWASP Top 10 A01 (broken access control); ISO 27001 A.5.15; RBI least privilege.
- **Fix:** each partition owns a list of zones or name suffixes and IP ranges (CIDR), managed by the Admin and audited.
  On create, the name must fall under one of the chosen partition's suffixes; for a PTR, the IP must fall in one of its
  ranges. An optional "critical" flag on a suffix or record can force four-eyes (SEC-03). Align with F5's answer on
  partitions (F3).

### SEC-11 · Medium · TLS is not end-to-end

- **Where:** `frontend/nginx.conf:22` (HTTP only), `application.yml` datasource URL (no `sslmode`),
  `auth/LdapDirectory.java:58` (any URL scheme accepted), `backend/Dockerfile:5-10` (extra CAs only in the build stage).
- **Issue:** TLS ends at the F5 VIP and everything behind it is plain text: VIP to NGINX, NGINX to backend, backend to
  PostgreSQL, PostgreSQL replication, backend to LDAP (`ldap://` is accepted, which sends user passwords in clear with
  a simple bind) and, later, Fluent Bit to the SIEM. The runtime image has no way to trust the Bank's internal CA, which
  tempts people to "fix" LDAPS or DB TLS errors by switching certificate checks off.
- **Standards:** RFP J3.5 (TLS 1.3+ and encryption at rest); ASVS V9.2.2 (TLS for all connections, including database
  and authentication); ISO 27001 A.8.24.
- **Fix:**
  - Re-encrypt from the VIP to NGINX (TLS 1.3; TLS 1.2 only where the Bank accepts it), or document an isolated
    network segment in the design and get it accepted.
  - JDBC with `sslmode=verify-full` and the Bank CA; TLS for Patroni replication and pgBackRest.
  - LDAPS (or StartTLS) only; refuse `ldap://` unless `PORTAL_ENV=local`.
  - Mount the Bank CA bundle at runtime (Spring Boot SSL bundles or a JVM trust store). Never "trust all".
  - Encryption at rest is infrastructure: encrypted volumes for the database and logs, and an encrypted pgBackRest
    repository.

### SEC-12 · Medium · Secrets in `.env` and the container environment

- **Where:** `docker-compose.yml:78-91`, `.env.example:16,35-36`.
- **Issue:** the DB password, LDAP bind password and Admin hash are plain environment variables from `.env`; anyone
  who can read the file or run `docker inspect` gets them. The template binds to LDAP as `cn=admin`, the directory
  administrator. The README and proposal say Vault/KMS, but the code has no Vault integration.
- **Standards:** ASVS V6.4.1; ISO 27001 A.5.17, A.8.24.
- **Fix:** Spring Cloud Vault (or the Bank's KMS) for the DB, LDAP and later F5 credentials, with rotation. At minimum,
  file-based secrets (`/run/secrets/...` read through `*_FILE` variables, mode 0400). Ask the Bank for a dedicated
  read-only LDAP service account. Keep `.env` for local development only.

### SEC-13 · Medium · Identity lifecycle controls are missing

- **Where:** `user/UserAdminService.java` (create `:159-183`, enable `:235-246`, reset `:260-276`), `auth/AuthService.java`.
- **Issue:**
  - No dormant-account rule: `last_login_at` is stored but never used.
  - Leavers: a removed directory user can no longer sign in, but the profile, access and open requests stay; local
    accounts keep working until the Admin disables them.
  - No periodic access review (who is a Checker, who has Write on which partition).
  - A local account can be created with any ID, and nothing checks that it belongs to a real employee. The Admin sees
    the first password, so the Admin can create an account and use it.
  - Temporary passwords never expire. Re-enabling a user silently restores their old access.
- **Standards:** RBI user access control (periodic review, removal on exit, dormant accounts); ISO 27001 A.5.16, A.5.18.
- **Fix:**
  - A nightly job disables accounts inactive for more than N days (Bank policy, often 90) and directory users no longer
    found in LDAP, and cancels their open requests.
  - A quarterly access-review report for IS.
  - Local accounts only by exception (vendor or break-glass), each with an owner and an expiry date, with the ID checked
    against the directory where possible.
  - Temporary passwords valid for 24–72 hours.
  - Re-enabling works as a fresh grant: the Admin confirms the access again.

### SEC-14 · Medium · Only the Admin can read the audit trail

- **Where:** `audit/AuditController.java:21` (`/api/admin/audit` only).
- **Issue:** the user with the widest powers (SEC-02) is the only one who can review the audit trail; there is no
  independent reviewer. The Auditor role in proposal v2.0 was dropped. Viewing or searching the audit trail is not
  itself recorded.
- **Standards:** ISO 27001 A.5.3, A.8.15; RBI audit log controls.
- **Fix:** add a read-only Auditor level (audit trail, records, requests and versions; no changes) and record
  audit-trail searches. The main independent review will be in the SIEM (SEC-05).

### SEC-15 · Medium · No automated tests or security scans

- **Where:** no tests in `backend/src/test` or `frontend`; `backend/Dockerfile:15` builds with `-DskipTests`.
- **Issue:** there are no tests for the access rules, and no static analysis (SAST), dependency scan, image scan or
  dynamic scan (DAST) in the build. RBI expects a secure development life cycle with code review and VAPT, and the
  Bank will run VAPT before go-live.
- **Fix:**
  - API tests for every rule in the README access table (each level against each endpoint, including the denied
    cases). The F5 work needs this safety net anyway (handover §7).
  - CI gates: SpotBugs with FindSecBugs or Semgrep (SAST), the scanners from SEC-04, an OWASP ZAP baseline scan against
    a running stack (DAST), and a secrets scan (gitleaks). Keep the reports as VAPT evidence.

### SEC-16 · Low · Maker rights not re-checked when an approved change runs

- **Where:** `change/ChangeExecutor.java:216-230` (`checkMaker`), `change/ChangeRequestService.java:337-375` (`approve`).
- **Issue:** before a change runs, the executor checks that the maker is active and, for a direct change, still a
  Checker. It does not check that a Write maker still has the partition. If the Admin removes a partition from a user
  or downgrades them to Read, their pending requests can still be approved and their approved scheduled changes still run.
- **Fix:** in `checkMaker`, require Write or Checker level and `canWriteGroup` for the request's partition. When access
  is reduced or a user is disabled, cancel their open requests and audit it.

### SEC-17 · Low · Information shown to the wrong audience

- **Where:** `web/PublicController.java:28-38`, `dashboard/HealthService.java:33-45`, `access/AccessRequestService.java:64-71`.
- **Issue:** without signing in, anyone can read the site name and role (Active/Standby), the version, whether LDAP
  is on, and the department list. Every signed-in user, including Read, sees the LDAP URL and the exact PostgreSQL
  version on the dashboard. Pending users (any employee, see SEC-09) see every partition name and description.
- **Fix:** the public endpoint returns only what the sign-in page needs, and the departments move to an authenticated
  endpoint. Health details are for the Admin only; other users see UP/DOWN. Pending users see partition names without
  descriptions.

### SEC-18 · Low · Insecure defaults

- **Where:** `application.yml:27` (`COOKIE_SECURE` defaults to false), `config/SampleDataLoader.java:85-95`,
  `DnsPortalApplication.java:15-16`, `config/AdminBootstrap.java:48`.
- **Issue:** forgetting one setting in UAT or production gives an insecure portal: the session cookie can travel over
  HTTP, and `SAMPLE_DATA=true` creates two Write accounts with the demo password and no forced change. `hash-password`
  takes the Admin password as a command argument, so it lands in shell history and the process list.
- **Fix:** secure by default: `COOKIE_SECURE` defaults to true (the local `.env` sets false); refuse to start with
  sample data unless `PORTAL_ENV=local`; read the `hash-password` input from the console without echo and check it
  against the password policy.

### SEC-19 · Low · Password rule details

- **Where:** `auth/PasswordPolicy.java:55`, `auth/AuthService.java:185`.
- **Issue:** passwords up to 128 characters are accepted, but bcrypt uses only the first 72 bytes. Spring Security 6.4.2
  silently ignores the rest (CVE-2025-22228); after the SEC-04 upgrade, a longer password makes the change fail with a
  500 error. Only the current password is blocked from reuse, and there is no common-password check.
- **Fix:** limit passwords to 64 characters and 72 UTF-8 bytes; keep the last N hashes (for example 5) and refuse reuse;
  reject passwords from a common-password list (ASVS V2.1.7). Align expiry and composition rules with the Bank IS
  policy (NIST SP 800-63B advises against forced rotation, but bank policies usually require it).

### SEC-20 · Low · Sign-in ID not validated

- **Where:** `auth/AuthService.java:60-69`; `audit_event.actor` is `VARCHAR(100)` (`V1__init.sql:136`).
- **Issue:** the ID is only trimmed and lower-cased; any string goes to the LDAP search and into the audit insert. An
  ID longer than 100 characters makes the audit insert fail, so the request returns 409 and the failed sign-in is not
  recorded.
- **Fix:** accept only the employee-ID pattern (for example 4–10 digits) or the Admin name, before any lookup. Reject
  anything else with the usual invalid-credentials message and audit it with the ID shortened.

### SEC-21 · Low · Browser and cookie hardening

- **Where:** `frontend/nginx.conf:36,47,56`, `application.yml:21-28`, `config/SecurityConfig.java:50`.
- **Fix:**
  - HSTS must be set where TLS ends, at the VIP (`max-age` of at least one year). Add it to the LB prerequisites.
  - Name the session cookie with the `__Host-` prefix (forces Secure, `Path=/` and no Domain).
  - The `XSRF-TOKEN` cookie takes its Secure flag from the request scheme. NGINX sends `X-Forwarded-Proto: http`, so
    behind the VIP the cookie is never Secure. The SEC-06 change (`https`) fixes it.
  - The CSP allows inline styles (`style-src 'unsafe-inline'`). This is acceptable for now; remove it once components
    stop using inline `style`. Add `Cross-Origin-Opener-Policy: same-origin` and
    `Cross-Origin-Resource-Policy: same-origin`.

### SEC-22 · Low · Container and runtime hardening

- **Where:** `frontend/Dockerfile:16`, `docker-compose.yml`, `backend/src/main/resources/logback-spring.xml:33`.
- **Fix:**
  - The NGINX master process runs as root: use an unprivileged NGINX image.
  - Pin every image by digest and rebuild monthly.
  - In Compose or the Bank's runtime: a read-only root file system (with tmpfs where needed), `cap_drop: [ALL]`,
    `no-new-privileges`, CPU and memory limits, and health checks for the backend and frontend.
  - `osixia/openldap:1.5.0` is unmaintained: keep it for development only; it is not needed in UAT or production.
  - `AUDIT_LOG_TOTAL_SIZE_CAP` deletes the oldest audit files when it is reached, even before 365 days. Size it from the
    expected volume and alert at 80%.
  - Sync all hosts to the Bank's NTP servers (CERT-In asks for time sources traceable to NIC or NPL).

## 4. Already done well

- **Queries:** all database access is parameterised (JPA criteria, named parameters, one parameterised native query),
  and LIKE searches escape wildcards (`common/Like.java`).
- **Access control:** partition scoping is enforced in the queries (`RecordSpecs`, `CrSpecs`) and checked on single
  reads. No IDOR was found.
- **Session and CSRF:** a new session ID at every sign-in; HttpOnly and SameSite=Strict session cookie; double-submit
  CSRF token; permissions read from the database on every request, so a disable or access change applies at once.
- **Passwords:** bcrypt cost 12, one generic invalid-credentials message, account lockout, forced change of temporary
  passwords. Bank passwords are never stored, and the LDAP search escapes the user ID and rejects empty passwords.
- **Workflow integrity:** row locks on decisions, `SKIP LOCKED` scheduler jobs, a stale-change re-check at run time, no
  self-approval, re-approval after an edit, and a comment required for a rejection.
- **Errors and endpoints:** no stack traces or internal messages returned; only the `health` actuator endpoint is
  exposed, without details, and NGINX does not route to it.
- **Audit:** every security event, including denied attempts, is written as a JSON line with a request ID. Jackson
  encodes it, so there is no log injection. Retention follows CERT-In.
- **Browser:** the CSP blocks inline scripts; `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`
  and `Permissions-Policy` are set; no `dangerouslySetInnerHTML` or `localStorage`; source maps are off.
- **Input:** strict DNS name, IP and TTL checks, F5 partition-name rule, ITSM reference pattern, length limits, request
  objects instead of entities (no mass assignment), page size capped at 200, 1 MB body limit.
- **Containers and repo:** the backend runs as a non-root user with `umask 027` logs; the DB port is bound to
  127.0.0.1; `.env` is not committed.

## 5. Security requirements for the F5 integration

For the `F5Provisioner` work (see `06-api-integration-handover.md`):

- **Account:** a dedicated F5 API account per environment, with the least-privilege role for the managed partitions
  (F5 question F5). Credentials come from Vault, never `.env`.
- **Authentication:** token-based (`/mgmt/shared/authn/login`) with a short token lifetime. Tokens stay in memory and are
  never logged or stored with results.
- **TLS:** verify the F5 management certificates against a dedicated trust store, with hostname checks on; never "trust
  all". TLS 1.2 is the F5 limit (the deviation is open).
- **Requests:** build F5 URLs and JSON with encoders, never by joining user input into `~Partition~name` paths. Call only
  the configured F5 devices; the portal takes no URL from users.
- **Reliability:** timeouts, limited retries, idempotency keys and the execution state machine from the handover. No F5
  call inside a database transaction.
- **Errors:** keep showing F5 error text as plain text (React escapes it), cap its length, and never store credentials
  or tokens with it.
- **Audit:** record every outbound change call (device, path, method, result code) without secret-bearing bodies.

## 6. Remediation plan

**Step 1: code changes that need no Bank input.** SEC-04, SEC-05 (roles, triggers, hash chain), SEC-06 (NGINX part),
SEC-07, SEC-08, SEC-09 (failure counting), SEC-15, SEC-16 to SEC-20, and the code parts of SEC-21 and SEC-22. Port
user-visible changes to `static-portal`.

**Step 2: before UAT, with the LB team and Bank infrastructure.** SEC-05 SIEM output; SEC-06 VIP addresses and
X-Forwarded-For at the VIP; SEC-09 LDAP group; SEC-11 TLS, LDAPS and the CA bundle; SEC-12 Vault/KMS and an LDAP
service account; SEC-21 HSTS at the VIP; NTP.

**Step 3: Bank decisions that change proposal v2.2 (raise via F5).** SEC-01 MFA; SEC-02 Admin model and PAM; SEC-03
four-eyes or compensating controls; SEC-10 partition-to-zone ownership (with F5 point F3); SEC-13 identity lifecycle
policy (dormancy days, review cycle, local accounts); SEC-14 Auditor role.

## 7. Standards used

| Standard | Relevant parts | Findings |
|---|---|---|
| RFP Section J | J1.2 MFA; J1.8 maker-checker; J3 audit trail to SIEM, patches, TLS 1.3+ and encryption at rest, DoS resistance, annual VAPT; J4.4 critical patches within 72 hours | SEC-01, 03, 04, 05, 06, 08, 11 |
| RBI Cyber Security Framework for Banks (2016), baseline controls | User access control (MFA for privileged access, least privilege, periodic review), application security life cycle, patch and vulnerability management, audit logs, VAPT | SEC-01 to 05, 09, 13 to 15 |
| RBI Master Direction on IT Governance, Risk, Controls and Assurance Practices (2023) | Access and privileged access control, audit trails, change management, vulnerability management, secure development | SEC-02 to 05, 13, 15 |
| CERT-In Directions (28-Apr-2022) | Logs kept 180 days in India; clocks synced to NIC/NPL time; incidents reported within 6 hours | SEC-05, 06, 22 |
| OWASP ASVS 4.0.3, Level 2 (Level 3 for authentication and audit) | V2 authentication, V3 sessions, V4 access control, V6.4 secrets, V7 logging, V9 TLS, V14 configuration and dependencies | all |
| ISO/IEC 27001:2022 Annex A | A.5.3 segregation of duties, A.5.15–A.5.18 access, A.8.2 privileged access, A.8.5 authentication, A.8.8 vulnerabilities, A.8.15 logging, A.8.24 cryptography, A.8.25–A.8.29 secure development | all |

**Not covered:** penetration testing; infrastructure (VIP, OS, PostgreSQL/Patroni settings); the F5 integration (not
built yet); `static-portal` (a demo that keeps data in the browser and is insecure by design, so it must never hold
real data).
