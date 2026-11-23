-- 02 · Data model — SBI F5 DNS Management Portal
-- Version 3.2 (Proposal v2.2 user/access model). PostgreSQL 16. Baseline migration 0001. Queue tables are created by Graphile Worker in schema graphile_worker.
-- Conventions: bigint identity PKs, timestamptz UTC, snake_case, soft-delete only where stated, audit is append-only.
--
-- v2.2 changes (summary):
--   * One access level per user: READ (all groups, group_id NULL), WRITE (rows per Admin-assigned group), CHECK
--     (always READ + WRITE, all groups, group_id NULL). Per-group CHECK removed.
--   * CRs from WRITE users go to all CHECK users + the Admin. CRs from CHECK users / the Admin (incl. rollbacks) are
--     direct: change_request.direct = true, no approval rows, executed after validation.
--   * F5 response per site kept on change_execution_item (f5_http_status, f5_error_code, f5_error_message) and shown on failure.
--
-- v2.1 changes (summary, superseded where v2.2 differs):
--   * Authentication is portal-local: one CONFIG Admin (credential hash in env/Vault, not in DB), LOCAL users
--     (Argon2id hash in DB) and LDAP users (validated against the Bank LDAP/directory API on every login).
--     No SSO / IdP / SAML / OIDC, no MFA, no AD group sync.  Removed: ad_group, ad_group_member, user_session.mfa_method,
--     app_user.external_id, role, permission, role_permission, access_grant.
--   * New login order and lockout: Admin (config) → LOCAL hash → LDAP-sourced user via LDAP → unknown user via LDAP
--     (auto-created as source=LDAP, status=PENDING_ACCESS, no permissions). Lockout after N failed attempts (default 5)
--     for M minutes (default 15); counters live on app_user.
--   * Permissions are READ | WRITE | CHECK per DNS group (user_permission); group_id NULL (= ALL groups) only for CHECK.
--     The Admin needs no rows (implicitly all groups, all permissions, plus user/group/permission management).
--   * Every record has exactly ONE owning group (record.owner_group_id; NULL = "Unassigned", Admin-only).
--     record.group_ids[] and change_request/change_item.group_ids[] removed. logical_group_rule is kept only as an
--     auto-assign hint for newly synced records.
--   * Approval: every eligible checker (CHECK on the CR's group or on ALL, plus the Admin) sees the CR; any one
--     eligible checker ≠ maker approves/rejects (reject needs a comment). Multi-level stays optional per group.
--   * Record versioning: record_version (append-only), label '1.' || version_no; committed only after successful
--     F5 execution. Rollback = Admin-only CR of kind ROLLBACK targeting a version_no; success commits a NEW version.
--     change_request.rollback_of and cr_status ROLLED_BACK removed.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE SCHEMA IF NOT EXISTS dns;
SET search_path = dns, public;

-- ───────────────────────────── Enums ─────────────────────────────
CREATE TYPE principal_kind   AS ENUM ('USER','API_CLIENT');
CREATE TYPE user_source      AS ENUM ('CONFIG','LOCAL','LDAP');               -- CONFIG = the single Admin
CREATE TYPE user_status      AS ENUM ('PENDING_ACCESS','ACTIVE','DISABLED','LOCKED');
CREATE TYPE perm_kind        AS ENUM ('READ','WRITE','CHECK');                -- WRITE implies READ
CREATE TYPE group_kind       AS ENUM ('DEPARTMENT','APPLICATION','LOCATION','USER_GROUP','CUSTOM');
CREATE TYPE rule_kind        AS ENUM ('ZONE','NAME_GLOB','NAME_REGEX','IP_CIDR','TAG','RECORD');
CREATE TYPE rr_type          AS ENUM ('A','AAAA','CNAME','MX','NS','PTR','TXT','SRV','CAA','DS','NAPTR','SOA');
CREATE TYPE driver_kind      AS ENUM ('RFC2136','ICONTROL_REST','BIGIQ');
CREATE TYPE target_mode      AS ENUM ('SYNC_GROUP','EACH');
CREATE TYPE drift_policy     AS ENUM ('ALERT_ONLY','ADOPT','REVERT');
CREATE TYPE cr_status        AS ENUM ('DRAFT','VALIDATING','PENDING_APPROVAL','APPROVED','SCHEDULED','QUEUED',
                                      'EXECUTING','SUCCEEDED','PARTIALLY_FAILED','FAILED','NEEDS_RECONCILIATION',
                                      'REJECTED','CANCELLED');
CREATE TYPE cr_kind          AS ENUM ('CHANGE','ROLLBACK');
CREATE TYPE cr_priority      AS ENUM ('NORMAL','EMERGENCY');
CREATE TYPE item_op          AS ENUM ('CREATE','UPDATE','DELETE');
CREATE TYPE version_op       AS ENUM ('CREATE','UPDATE','DELETE','ROLLBACK');
CREATE TYPE approval_action  AS ENUM ('APPROVE','REJECT');
CREATE TYPE exec_status      AS ENUM ('PENDING','RUNNING','SUCCEEDED','FAILED','CONFLICT','SKIPPED');
CREATE TYPE drift_status     AS ENUM ('OPEN','ADOPTED','REVERTED','IGNORED');

-- ───────────────────────────── Identity & access ─────────────────────────────
-- Login order (api `auth` module):
--   1. username = configured Admin username  → verify ADMIN_PASSWORD_HASH from env/Vault (Argon2id); row source=CONFIG
--   2. LOCAL user                            → verify password_hash (Argon2id)
--   3. LDAP user                             → validate against the Bank LDAP/directory API (every login; no password stored)
--   4. username not found                    → validate against LDAP; on success insert source=LDAP, status=PENDING_ACCESS
-- Failures return a generic INVALID_CREDENTIALS. failed_attempts ≥ LOGIN_MAX_ATTEMPTS (5) → status LOCKED,
-- locked_until = now() + LOGIN_LOCK_MINUTES (15). An LDAP outage never blocks CONFIG/LOCAL logins.
CREATE TABLE app_user (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username             text NOT NULL,                     -- login name; LDAP: sAMAccountName / uid as returned by the Bank API
  source               user_source NOT NULL,
  status               user_status NOT NULL DEFAULT 'ACTIVE',
  display_name         text NOT NULL,
  email                text,
  department           text,
  ldap_dn              text,                              -- LDAP users only (identity / DN from the directory API)
  password_hash        text,                              -- LOCAL users only, Argon2id
  must_change_password boolean NOT NULL DEFAULT false,    -- LOCAL users: set on create / admin reset
  password_changed_at  timestamptz,
  failed_attempts      int NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_by           bigint REFERENCES app_user(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'LOCAL')  = (password_hash IS NOT NULL)),
  CHECK (source = 'LDAP' OR ldap_dn IS NULL),
  CHECK (source <> 'CONFIG' OR status = 'ACTIVE'),        -- the Admin cannot be pending/disabled via the DB
  CHECK (source = 'LOCAL' OR must_change_password = false)
);
CREATE UNIQUE INDEX app_user_username_ci ON app_user (lower(username));
CREATE UNIQUE INDEX app_user_single_admin ON app_user ((true)) WHERE source = 'CONFIG';   -- exactly one Admin row
CREATE INDEX app_user_status_idx ON app_user (status) WHERE status IN ('PENDING_ACCESS','LOCKED');

CREATE TABLE api_client (                                 -- portal-issued API keys only (no IdP client-credentials)
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  client_id       text NOT NULL UNIQUE,                  -- public key id (prefix of the presented key)
  secret_hash     text NOT NULL,                         -- argon2id
  allowed_cidrs   cidr[] NOT NULL DEFAULT '{}',
  owner_user_id   bigint REFERENCES app_user(id),
  is_active       boolean NOT NULL DEFAULT true,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_session (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  auth_source     user_source NOT NULL,                  -- how this session was authenticated (CONFIG / LOCAL / LDAP)
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX ON user_session (user_id) WHERE revoked_at IS NULL;

-- ───────────────────────────── DNS groups (J1.4) ─────────────────────────────
CREATE TABLE logical_group (                              -- "DNS group": department / application / location / user group
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            group_kind NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  parent_id       int REFERENCES logical_group(id),
  owner_user_id   bigint REFERENCES app_user(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, code)
);

-- Auto-assign hint only: when sync discovers a NEW record with no owner, the first matching rule (lowest priority)
-- sets record.owner_group_id. Rules never change the owner of an existing record (that is an Admin action).
CREATE TABLE logical_group_rule (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id        int NOT NULL REFERENCES logical_group(id) ON DELETE CASCADE,
  kind            rule_kind NOT NULL,
  zone_id         bigint,                                -- optional zone restriction for any rule kind
  value           text NOT NULL,                         -- glob / regex / cidr / tag / record id
  priority        int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON logical_group_rule (group_id);

-- Access level grants (v2.2). One level per user (enforced in the service):
--   READ  → one row, group_id NULL (= all groups, no group assignment)
--   WRITE → one row per Admin-assigned group (implies READ on those groups only)
--   CHECK → one row, group_id NULL (= all groups; always includes READ + WRITE; own changes need no approval)
-- The Admin (source CONFIG) has no rows: implicitly CHECK plus user/group/permission management, compare and rollback.
CREATE TABLE user_permission (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  group_id        int REFERENCES logical_group(id) ON DELETE CASCADE,   -- WRITE only; NULL for READ / CHECK (= all groups)
  permission      perm_kind NOT NULL,
  granted_by      bigint REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((permission = 'WRITE') = (group_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (user_id, group_id, permission)
);
CREATE INDEX ON user_permission (group_id, permission);

CREATE TABLE api_client_permission (                      -- same model for automation keys
  api_client_id   bigint NOT NULL REFERENCES api_client(id) ON DELETE CASCADE,
  group_id        int REFERENCES logical_group(id) ON DELETE CASCADE,
  permission      perm_kind NOT NULL,
  CHECK ((permission = 'WRITE') = (group_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (api_client_id, group_id, permission)
);

-- ───────────────────────────── F5 topology & zones ─────────────────────────────
CREATE TABLE f5_target (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL UNIQUE,                -- DC-GTM-01, DR-GTM-01, AZ-GTM-01, BIGIQ-CM
  site              text NOT NULL CHECK (site IN ('DC','DR','AZ')),
  driver            driver_kind NOT NULL,
  mgmt_endpoint     text NOT NULL,                       -- https://host or dns://host:53
  vault_secret_ref  text NOT NULL,                       -- credentials / TSIG key live in Vault
  sync_group        text,
  max_concurrency   int  NOT NULL DEFAULT 4 CHECK (max_concurrency BETWEEN 1 AND 64),
  rate_per_sec      int  NOT NULL DEFAULT 20,
  is_enabled        boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zone (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fqdn             text NOT NULL UNIQUE,                 -- lower-case, trailing dot stripped
  view_name        text NOT NULL DEFAULT 'external',
  is_reverse       boolean NOT NULL DEFAULT false,
  target_mode      target_mode NOT NULL DEFAULT 'SYNC_GROUP',
  drift_policy     drift_policy NOT NULL DEFAULT 'ALERT_ONLY',
  ttl_min          int NOT NULL DEFAULT 60,
  ttl_max          int NOT NULL DEFAULT 86400,
  is_managed       boolean NOT NULL DEFAULT true,
  record_count     bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zone_fqdn_trgm ON zone USING gin (fqdn gin_trgm_ops);

ALTER TABLE logical_group_rule ADD FOREIGN KEY (zone_id) REFERENCES zone(id) ON DELETE CASCADE;

CREATE TABLE zone_target (
  zone_id          bigint NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
  target_id        bigint NOT NULL REFERENCES f5_target(id),
  is_write_target  boolean NOT NULL DEFAULT true,        -- SYNC_GROUP: exactly one true per zone
  last_serial      bigint,
  last_sync_at     timestamptz,
  last_sync_status text,
  PRIMARY KEY (zone_id, target_id)
);

-- ───────────────────────────── Inventory (J1.5) ─────────────────────────────
-- convert_to() is only STABLE; the DB is fixed to UTF8 so this wrapper is safe to declare IMMUTABLE.
CREATE FUNCTION sha256_text(t text) RETURNS bytea LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT sha256(convert_to(t, 'UTF8')) $$;

-- Hash-partitioned by zone_id. PK includes partition key.
CREATE TABLE record (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  zone_id          bigint NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
  owner_name       text NOT NULL,                        -- FQDN as stored on F5
  owner_name_lc    text GENERATED ALWAYS AS (lower(owner_name)) STORED,
  rr_type          rr_type NOT NULL,
  ttl              int NOT NULL CHECK (ttl BETWEEN 0 AND 2147483647),
  rdata            jsonb NOT NULL,                       -- typed fields, e.g. {"address":"10.1.1.1"} / {"pref":10,"exchange":"mx.sbi."}
  rdata_text       text NOT NULL,                        -- canonical presentation form
  rdata_hash       bytea GENERATED ALWAYS AS (sha256_text(rdata_text)) STORED,
  ip_addr          inet,                                 -- A/AAAA address, PTR reverse-mapped IP
  cname_target     text,                                 -- for CNAME loop graph
  owner_group_id   int REFERENCES logical_group(id),     -- exactly one owning DNS group; NULL = "Unassigned" (Admin-only)
  tags             text[] NOT NULL DEFAULT '{}',
  is_protected     boolean NOT NULL DEFAULT false,
  version          bigint NOT NULL DEFAULT 1,            -- internal concurrency counter / ETag (bumps on every observed change incl. drift)
  current_version_no int,                                -- latest record_version.version_no (label '1.' || n); NULL = never changed via portal
  source_serial    bigint,
  last_changed_by_cr bigint,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, id),
  UNIQUE (zone_id, owner_name_lc, rr_type, rdata_hash)
) PARTITION BY HASH (zone_id);

DO $$
BEGIN
  FOR i IN 0..31 LOOP
    EXECUTE format('CREATE TABLE dns.record_p%s PARTITION OF dns.record FOR VALUES WITH (MODULUS 32, REMAINDER %s)', i, i);
  END LOOP;
END $$;

CREATE INDEX record_rrset_idx    ON record (zone_id, owner_name_lc, rr_type);
CREATE INDEX record_name_trgm    ON record USING gin (owner_name_lc gin_trgm_ops);
CREATE INDEX record_name_prefix  ON record (owner_name_lc text_pattern_ops);
CREATE INDEX record_ip_idx       ON record USING gist (ip_addr inet_ops) WHERE ip_addr IS NOT NULL;
CREATE INDEX record_owner_group  ON record (owner_group_id, zone_id, owner_name_lc);  -- authz filter: owner_group_id = ANY($userGroups)
CREATE INDEX record_cname_idx    ON record (cname_target) WHERE rr_type = 'CNAME';
CREATE INDEX record_keyset_idx   ON record (zone_id, owner_name_lc, rr_type, id);   -- cursor pagination

CREATE TABLE record_history (                            -- every observed change (portal or drift)
  id               bigint GENERATED ALWAYS AS IDENTITY,
  zone_id          bigint NOT NULL,
  record_id        bigint NOT NULL,
  version          bigint NOT NULL,
  op               item_op NOT NULL,
  before_rr        jsonb,
  after_rr         jsonb,
  cr_id            bigint,                               -- NULL ⇒ out-of-band (drift)
  observed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observed_at, id)
) PARTITION BY RANGE (observed_at);
CREATE INDEX ON record_history (zone_id, record_id, version);

-- ───────────────────────────── Workflow policy (J1.8, J1.9) ─────────────────────────────
-- Applies only to CRs raised by WRITE users. Eligible approvers are derived, not configured per level: all CHECK users
-- plus the Admin. Default: 1 level, 1 approver (any one of them). Direct CRs (CHECK / Admin makers) bypass the policy.
CREATE TABLE approval_policy (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id                int REFERENCES logical_group(id),   -- NULL = default policy
  name                    text NOT NULL,
  levels                  smallint NOT NULL DEFAULT 1 CHECK (levels BETWEEN 1 AND 3),
  requires_itsm_approved  boolean NOT NULL DEFAULT true,
  requires_change_window  boolean NOT NULL DEFAULT false,
  auto_approve_rule       jsonb,                              -- e.g. {"ops":["UPDATE"],"fields":["ttl"]}; auto-approval is still audited
  sla_minutes             int NOT NULL DEFAULT 240,
  is_active               boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (group_id)
);

CREATE TABLE approval_policy_level (
  policy_id        bigint NOT NULL REFERENCES approval_policy(id) ON DELETE CASCADE,
  level_no         smallint NOT NULL,
  min_approvers    smallint NOT NULL DEFAULT 1 CHECK (min_approvers >= 1),
  PRIMARY KEY (policy_id, level_no)
);

CREATE TABLE change_window (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text NOT NULL,
  group_id         int REFERENCES logical_group(id),    -- NULL = global
  is_freeze        boolean NOT NULL DEFAULT false,      -- true = blackout
  rrule            text,                                -- RFC 5545 recurrence, or NULL for one-off
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL CHECK (ends_at > starts_at),
  created_by       bigint REFERENCES app_user(id)
);

-- ───────────────────────────── Change requests ─────────────────────────────
CREATE TABLE change_request (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref              text NOT NULL UNIQUE,                 -- DNS-2026-000123
  kind             cr_kind NOT NULL DEFAULT 'CHANGE',
  title            text NOT NULL,
  justification    text NOT NULL,
  status           cr_status NOT NULL DEFAULT 'DRAFT',
  priority         cr_priority NOT NULL DEFAULT 'NORMAL',
  maker_kind       principal_kind NOT NULL,
  maker_id         bigint NOT NULL,
  group_id         int REFERENCES logical_group(id),     -- the single DNS group all items belong to; NULL only for Admin CRs on Unassigned records
  direct           boolean NOT NULL DEFAULT false,       -- v2.2: raised by a CHECK user or the Admin → no approval
  policy_id        bigint REFERENCES approval_policy(id),  -- NULL for direct CRs
  current_level    smallint NOT NULL DEFAULT 0,
  run_at           timestamptz,                          -- scheduled execution (CHANGE or ROLLBACK)
  target_zone_id   bigint,                               -- ROLLBACK: record being restored
  target_record_id bigint,
  target_version_no int,                                 -- ROLLBACK: version whose snapshot is restored
  itsm_change_ref  text,
  itsm_status      text,
  post_facto_ticket boolean NOT NULL DEFAULT false,
  item_count       int NOT NULL DEFAULT 0,
  failure_reason   text,
  version          int NOT NULL DEFAULT 1,               -- optimistic lock for transitions
  created_at       timestamptz NOT NULL DEFAULT now(),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'ROLLBACK') = (target_version_no IS NOT NULL AND target_record_id IS NOT NULL AND target_zone_id IS NOT NULL))
);
CREATE INDEX cr_status_idx  ON change_request (status, run_at);
CREATE INDEX cr_maker_idx   ON change_request (maker_kind, maker_id, created_at DESC);
CREATE INDEX cr_group_idx   ON change_request (group_id, status);              -- approval inbox: status = PENDING_APPROVAL
CREATE INDEX cr_rollback_idx ON change_request (target_zone_id, target_record_id) WHERE kind = 'ROLLBACK';
CREATE SEQUENCE change_request_ref_seq;

CREATE TABLE change_item (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cr_id            bigint NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  seq              int NOT NULL,
  zone_id          bigint NOT NULL REFERENCES zone(id),
  op               item_op NOT NULL,
  owner_name       text NOT NULL,
  rr_type          rr_type NOT NULL,
  record_id        bigint,                               -- for UPDATE/DELETE
  expected_version bigint,                               -- STALE check at submit & execution
  before_rr        jsonb,                                -- {ttl, rdata, rdata_text}
  after_rr         jsonb,
  validation       jsonb NOT NULL DEFAULT '[]',          -- warnings retained for approver view
  UNIQUE (cr_id, seq),
  CHECK ((op = 'CREATE' AND before_rr IS NULL AND after_rr IS NOT NULL)
      OR (op = 'UPDATE' AND before_rr IS NOT NULL AND after_rr IS NOT NULL)
      OR (op = 'DELETE' AND before_rr IS NOT NULL AND after_rr IS NULL))
);
CREATE INDEX ci_rrset_idx ON change_item (zone_id, lower(owner_name), rr_type);  -- duplicate-open-CR check

-- Only CHECK users and the Admin may approve (enforced in the approval service); WRITE users cannot.
-- Direct CRs (change_request.direct = true) have no approval rows.
CREATE TABLE approval (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cr_id            bigint NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  level_no         smallint NOT NULL,
  approver_id      bigint NOT NULL REFERENCES app_user(id),
  action           approval_action NOT NULL,
  comment          text,
  acted_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cr_id, approver_id),                           -- one person, one decision per CR (no one approves at two levels)
  CHECK (action <> 'REJECT' OR length(btrim(coalesce(comment, ''))) > 0)
);

-- ───────────────────────────── Record versions (v2.1) — append-only ─────────────────────────────
-- One row per successfully applied portal change of a record. Pending / rejected / failed CRs create no version.
-- version_no 0 → "1.0", 3 → "1.3", 10 → "1.10". DELETE keeps the last config so the record can be restored.
-- ROLLBACK rows copy the snapshot of rolled_back_from_version_no (e.g. at 1.3 restoring 1.1 creates 1.4 with
-- rolled_back_from_version_no = 1). No FK to record: versions outlive deleted records.
CREATE TABLE record_version (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id          bigint NOT NULL REFERENCES zone(id),
  record_id        bigint NOT NULL,
  owner_name_lc    text NOT NULL,                        -- rrset key kept for lookup after delete
  rr_type          rr_type NOT NULL,
  version_no       int NOT NULL CHECK (version_no >= 0),
  version_label    text GENERATED ALWAYS AS ('1.' || version_no::text) STORED,
  op               version_op NOT NULL,
  snapshot         jsonb NOT NULL,                       -- full config: zone, name, type, ttl, rdata, rdata_text, F5 object config
  owner_group_id   int REFERENCES logical_group(id),
  cr_id            bigint NOT NULL REFERENCES change_request(id),
  maker_id         bigint REFERENCES app_user(id),
  checker_id       bigint REFERENCES app_user(id),       -- approver; NULL for direct changes (CHECK user / Admin)
  reason           text,
  itsm_ref         text,
  applied_at       timestamptz NOT NULL DEFAULT now(),
  per_site_result  jsonb NOT NULL DEFAULT '{}',          -- {"DC-GTM-01":"SUCCEEDED","DR-GTM-01":"SUCCEEDED",...}
  rolled_back_from_version_no int,                       -- ROLLBACK only: the version whose snapshot was restored
  UNIQUE (zone_id, record_id, version_no),
  CHECK ((op = 'ROLLBACK') = (rolled_back_from_version_no IS NOT NULL)),
  CHECK (rolled_back_from_version_no IS NULL OR rolled_back_from_version_no < version_no)
);
CREATE INDEX record_version_rrset_idx ON record_version (zone_id, owner_name_lc, rr_type, version_no DESC);

CREATE FUNCTION record_version_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'record_version is append-only';
END $$;
CREATE TRIGGER record_version_immutable BEFORE UPDATE OR DELETE ON record_version
  FOR EACH ROW EXECUTE FUNCTION record_version_block_mutation();

-- ───────────────────────────── Execution ─────────────────────────────
CREATE TABLE change_execution (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cr_id            bigint NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  target_id        bigint NOT NULL REFERENCES f5_target(id),
  zone_id          bigint NOT NULL REFERENCES zone(id),
  batch_no         int NOT NULL,
  status           exec_status NOT NULL DEFAULT 'PENDING',
  job_key          text NOT NULL UNIQUE,                 -- cr:{id}:zone:{z}:target:{t}:batch:{n}
  attempts         int NOT NULL DEFAULT 0,
  started_at       timestamptz,
  finished_at      timestamptz,
  error_code       text,
  error_detail     text
);
CREATE INDEX ON change_execution (cr_id);
CREATE INDEX ON change_execution (status) WHERE status IN ('PENDING','RUNNING');

CREATE TABLE change_execution_item (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  execution_id     bigint NOT NULL,
  item_id          bigint NOT NULL,
  status           exec_status NOT NULL DEFAULT 'PENDING',
  attempt          int NOT NULL DEFAULT 0,
  driver_request_id text,
  result           jsonb,
  error_code       text,
  f5_http_status   int,                                  -- v2.2: F5 response for this site, stored as returned
  f5_error_code    text,                                 --       shown per site on the request page when the change fails
  f5_error_message text,
  duration_ms      int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
CREATE INDEX ON change_execution_item (execution_id);
CREATE INDEX ON change_execution_item (item_id);

-- ───────────────────────────── Sync & drift ─────────────────────────────
CREATE TABLE sync_run (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id          bigint NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
  target_id        bigint NOT NULL REFERENCES f5_target(id),
  method           text NOT NULL CHECK (method IN ('IXFR','AXFR','API')),
  from_serial      bigint,
  to_serial        bigint,
  added            int NOT NULL DEFAULT 0,
  removed          int NOT NULL DEFAULT 0,
  changed          int NOT NULL DEFAULT 0,
  drift_found      int NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'RUNNING',
  error_detail     text
);
CREATE INDEX ON sync_run (zone_id, started_at DESC);

CREATE TABLE drift_event (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id          bigint NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
  target_id        bigint NOT NULL REFERENCES f5_target(id),
  sync_run_id      bigint REFERENCES sync_run(id),
  owner_name       text NOT NULL,
  rr_type          rr_type NOT NULL,
  op               item_op NOT NULL,
  portal_rr        jsonb,
  f5_rr            jsonb,
  status           drift_status NOT NULL DEFAULT 'OPEN',
  resolved_by      bigint REFERENCES app_user(id),
  resolution_cr_id bigint REFERENCES change_request(id),
  detected_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX ON drift_event (status, detected_at DESC);

-- ───────────────────────────── Audit (J3.1) — append-only, hash-chained ─────────────────────────────
CREATE TABLE audit_event (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind       principal_kind,
  actor_id         bigint,
  actor_name       text,
  session_id       uuid,
  source_ip        inet,
  action           text NOT NULL,                        -- e.g. CR.APPROVE, RECORD.ROLLBACK, AUTH.LOGIN_FAILED, AUTH.LOCKED, USER.PERMISSIONS_SET
  entity_type      text NOT NULL,
  entity_id        text,
  outcome          text NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','DENIED')),
  detail           jsonb NOT NULL DEFAULT '{}',
  trace_id         text,
  prev_hash        bytea,
  hash             bytea NOT NULL,
  siem_shipped_at  timestamptz,
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX ON audit_event (entity_type, entity_id);
CREATE INDEX ON audit_event (actor_kind, actor_id, occurred_at DESC);
CREATE INDEX audit_unshipped ON audit_event (id) WHERE siem_shipped_at IS NULL;

CREATE FUNCTION audit_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.siem_shipped_at IS DISTINCT FROM OLD.siem_shipped_at
     AND (to_jsonb(NEW) - 'siem_shipped_at') = (to_jsonb(OLD) - 'siem_shipped_at') THEN
    RETURN NEW;                                          -- only the SIEM ship marker may change
  END IF;
  RAISE EXCEPTION 'audit_event is append-only';
END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();

-- ───────────────────────────── Outbox, idempotency, settings ─────────────────────────────
CREATE TABLE outbox (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic            text NOT NULL,                        -- itsm.create, itsm.update, itsm.incident, notify.email, cr.dispatch, search.index
  aggregate_type   text NOT NULL,
  aggregate_id     text NOT NULL,
  payload          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  relayed_at       timestamptz
);
CREATE INDEX outbox_pending ON outbox (id) WHERE relayed_at IS NULL;

CREATE TABLE idempotency_key (
  principal_kind   principal_kind NOT NULL,
  principal_id     bigint NOT NULL,
  key              text NOT NULL,
  request_hash     bytea NOT NULL,
  status_code      int,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_kind, principal_id, key)
);
CREATE INDEX ON idempotency_key (created_at);

CREATE TABLE itsm_mapping (
  group_id         int PRIMARY KEY REFERENCES logical_group(id) ON DELETE CASCADE,
  service          text NOT NULL,
  category         text NOT NULL,
  ci_name          text,
  assignee_group   text NOT NULL
);

CREATE TABLE system_setting (                             -- e.g. login.max_attempts = 5, login.lock_minutes = 15
  key              text PRIMARY KEY,
  value            jsonb NOT NULL,
  updated_by       bigint REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── Reporting (J1.11) ─────────────────────────────
CREATE MATERIALIZED VIEW mv_group_record_counts AS        -- Unassigned records (owner_group_id NULL) are excluded
  SELECT g.id AS group_id, g.kind, g.name, r.rr_type, count(*)::bigint AS record_count
  FROM record r
  JOIN logical_group g ON g.id = r.owner_group_id
  GROUP BY g.id, g.kind, g.name, r.rr_type;
CREATE UNIQUE INDEX ON mv_group_record_counts (group_id, rr_type);

-- ───────────────────────────── Initial monthly partitions (housekeeping job creates the rest) ─────────────────────────────
DO $$
DECLARE m date := date_trunc('month', now())::date;
BEGIN
  FOR i IN 0..3 LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS dns.audit_event_%s PARTITION OF dns.audit_event FOR VALUES FROM (%L) TO (%L)',
                   to_char(m + (i||' month')::interval, 'YYYYMM'), m + (i||' month')::interval, m + ((i+1)||' month')::interval);
    EXECUTE format('CREATE TABLE IF NOT EXISTS dns.change_execution_item_%s PARTITION OF dns.change_execution_item FOR VALUES FROM (%L) TO (%L)',
                   to_char(m + (i||' month')::interval, 'YYYYMM'), m + (i||' month')::interval, m + ((i+1)||' month')::interval);
    EXECUTE format('CREATE TABLE IF NOT EXISTS dns.record_history_%s PARTITION OF dns.record_history FOR VALUES FROM (%L) TO (%L)',
                   to_char(m + (i||' month')::interval, 'YYYYMM'), m + (i||' month')::interval, m + ((i+1)||' month')::interval);
  END LOOP;
END $$;

-- ───────────────────────────── Change notifications (cache invalidation / SSE) ─────────────────────────────
CREATE FUNCTION notify_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  -- payload stays tiny (< 8 KB NOTIFY limit); listeners re-read what they need
  PERFORM pg_notify(TG_ARGV[0], jsonb_build_object('op', TG_OP, 'id', r->>'id', 'zone', r->>'zone_id')::text);
  RETURN NULL;
END $$;
-- NOTE: no row trigger on `record` — a sync of 1M rows would emit 1M notifications.
-- Executors/sync jobs call pg_notify('record_changed', '{"zone":<id>}') once per zone per transaction instead.
CREATE TRIGGER cr_changed AFTER INSERT OR UPDATE ON change_request
  FOR EACH ROW EXECUTE FUNCTION notify_change('cr_changed');
CREATE TRIGGER permission_changed AFTER INSERT OR UPDATE OR DELETE ON user_permission
  FOR EACH ROW EXECUTE FUNCTION notify_change('authz_changed');
CREATE TRIGGER user_changed AFTER UPDATE OF status ON app_user                 -- disable / lock → drop cached permissions & sessions
  FOR EACH ROW EXECUTE FUNCTION notify_change('authz_changed');

-- ───────────────────────────── DB roles (least privilege) ─────────────────────────────
-- CREATE ROLE app_rw NOLOGIN;  GRANT USAGE ON SCHEMA dns TO app_rw;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dns TO app_rw;
-- REVOKE UPDATE, DELETE ON dns.audit_event FROM app_rw;  GRANT UPDATE (siem_shipped_at) ON dns.audit_event TO app_rw;
-- REVOKE UPDATE, DELETE ON dns.record_version FROM app_rw;
-- CREATE ROLE app_ro NOLOGIN;  GRANT SELECT ON ALL TABLES IN SCHEMA dns TO app_ro;
-- CREATE ROLE auditor_ro NOLOGIN; GRANT SELECT ON dns.audit_event, dns.record_history, dns.record_version, dns.change_request, dns.approval TO auditor_ro;
