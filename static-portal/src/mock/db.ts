/**
 * The static portal's "database": one JSON document in the browser's localStorage.
 * Same entities as the real portal's PostgreSQL schema (users, partitions, records, versions,
 * change requests, access requests, audit) plus the mock Bank directory and demo settings.
 */
import type { AccessLevel, CrStatus, MappingType, Operation, RecordType, SiteResult, UserSource, UserStatus } from '../types';
import { FIRST_REVISION, formatVersion, m, validateSpec } from './rules';
import { hashPassword } from './sha256';

export const STORAGE_KEY = 'dnsportal.static.v1';
const SESSION_KEY = 'dnsportal.static.session';
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const AUDIT_CAP = 5000;

export interface UserRec {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  department: string | null;
  source: UserSource;
  passwordHash: string | null;
  level: AccessLevel;
  status: UserStatus;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  groupIds: number[];
}

export interface GroupRec {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface RecordRec {
  id: number;
  groupId: number;
  recordType: RecordType;
  mappingType: MappingType;
  recordKey: string;
  domain: string;
  ips: string[];
  ptrName: string | null;
  ttl: number;
  revision: number;
  status: 'ACTIVE' | 'DELETED';
  searchText: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface VersionRec {
  id: number;
  recordId: number;
  revision: number;
  snapshot: Record<string, unknown>;
  deleted: boolean;
  changeRequestId: number | null;
  createdAt: string;
  createdBy: string | null;
}

export interface CrRec {
  id: number;
  operation: Operation;
  status: CrStatus;
  direct: boolean;
  groupId: number;
  recordId: number | null;
  recordType: RecordType;
  recordKey: string;
  baseRevision: number | null;
  resultRevision: number | null;
  targetRevision: number | null;
  scheduledAt: string | null;
  proposed: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
  reason: string;
  itsmRef: string | null;
  makerId: number;
  createdAt: string;
  updatedAt: string;
  decidedById: number | null;
  decidedAt: string | null;
  decisionComment: string | null;
  executedAt: string | null;
  executionResult: SiteResult[] | null;
  errorMessage: string | null;
}

export interface AccessReqRec {
  id: number;
  userId: number;
  department: string;
  requestedLevel: AccessLevel;
  requestedGroupIds: number[];
  reason: string;
  status: 'OPEN' | 'GRANTED' | 'DECLINED';
  createdAt: string;
  updatedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
}

export interface AuditRec {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  clientIp: string | null;
  site: string | null;
}

/** A user in the mock Bank directory (LDAP): ID, name, email and password only. */
export interface DirectoryUser {
  uid: string;
  name: string;
  email: string | null;
  passwordHash: string;
}

export interface Settings {
  siteName: string;
  siteRole: 'Active' | 'Standby';
  ldapEnabled: boolean;
  f5FailSuffix: string;
  adminUsername: string;
  adminPasswordHash: string;
  /** Departments users choose from (empty: free text). */
  departments: string[];
}

export const DEFAULT_DEPARTMENTS = ['Core Banking', 'Digital Banking', 'Information Security', 'IT Infrastructure', 'Network Operations', 'Payments'];

export interface Db {
  version: 1;
  seq: Record<string, number>;
  settings: Settings;
  users: UserRec[];
  groups: GroupRec[];
  records: RecordRec[];
  versions: VersionRec[];
  changeRequests: CrRec[];
  accessRequests: AccessReqRec[];
  audit: AuditRec[];
  directory: DirectoryUser[];
}

export const nowIso = () => new Date().toISOString();

export function nextId(db: Db, kind: string): number {
  db.seq[kind] = (db.seq[kind] ?? 0) + 1;
  return db.seq[kind];
}

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ---------------------------------------------------------------- load / save

export function loadDb(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      if (db && db.version === 1 && Array.isArray(db.users)) {
        if (!Array.isArray(db.settings.departments)) db.settings.departments = [...DEFAULT_DEPARTMENTS]; // data saved before departments existed
        return db;
      }
    }
  } catch {
    /* corrupt or blocked storage: start again */
  }
  const db = seedDb();
  saveDb(db);
  return db;
}

export function saveDb(db: Db): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    throw new Error('The browser refused to save portal data (storage full or blocked). ' + String(e));
  }
}

export function storageBytes(): number {
  return (localStorage.getItem(STORAGE_KEY) ?? '').length * 2;
}

// ---------------------------------------------------------------- session (like the server-side HTTP session)

interface Session {
  userId: number;
  lastActive: number;
}

export function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    return s && typeof s.userId === 'number' ? s : null;
  } catch {
    return null;
  }
}

export function writeSession(userId: number): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, lastActive: Date.now() }));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

// ---------------------------------------------------------------- record helpers shared with the change engine

export function searchTextOf(r: Pick<RecordRec, 'domain' | 'ips' | 'ptrName'>): string {
  return `${r.domain} ${r.ips.join(' ')}${r.ptrName ? ` ${r.ptrName}` : ''}`.toLowerCase();
}

export function snapshotOf(db: Db, r: RecordRec): Record<string, unknown> {
  const g = db.groups.find((x) => x.id === r.groupId);
  return m({
    group: g?.name,
    groupId: r.groupId,
    recordType: r.recordType,
    mappingType: r.mappingType,
    domain: r.domain,
    ips: [...r.ips],
    ptrName: r.ptrName,
    ttl: r.ttl,
    version: formatVersion(r.revision),
    status: r.status,
  });
}

// ---------------------------------------------------------------- sample data (same as the real portal's SAMPLE_DATA)

export const SAMPLE_PASSWORD = '12345677';
export const ADMIN_PASSWORD = 'Admin@Portal2026';

export function seedDb(): Db {
  const now = nowIso();
  const db: Db = {
    version: 1,
    seq: {},
    settings: {
      siteName: 'DC-1',
      siteRole: 'Active',
      ldapEnabled: true,
      f5FailSuffix: '.fail.test',
      adminUsername: 'admin',
      adminPasswordHash: hashPassword(ADMIN_PASSWORD),
      departments: [...DEFAULT_DEPARTMENTS],
    },
    users: [],
    groups: [],
    records: [],
    versions: [],
    changeRequests: [],
    accessRequests: [],
    audit: [],
    directory: [],
  };

  const user = (u: Partial<UserRec> & Pick<UserRec, 'username' | 'source' | 'level' | 'status'>): UserRec => {
    const rec: UserRec = {
      id: nextId(db, 'user'),
      displayName: null,
      email: null,
      department: null,
      passwordHash: null,
      mustChangePassword: false,
      passwordChangedAt: null,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      createdBy: 'sample-data',
      groupIds: [],
      ...u,
    };
    db.users.push(rec);
    return rec;
  };

  user({ username: 'admin', displayName: 'Portal Administrator', source: 'CONFIG', level: 'ADMIN', status: 'ACTIVE', createdBy: 'configuration' });

  const partition = (name: string, description: string) => {
    const g: GroupRec = { id: nextId(db, 'group'), name, description, createdAt: now, createdBy: 'sample-data' };
    db.groups.push(g);
    return g;
  };
  const ib = partition('Internet_Banking', 'Internet and mobile banking front ends');
  const cb = partition('Core_Banking', 'Core banking (CBS) services');
  const upi = partition('UPI_Payments', 'UPI and payment switch services');

  const sampleHash = hashPassword(SAMPLE_PASSWORD);
  user({ username: '140122', displayName: 'Pravez', source: 'LOCAL', level: 'WRITE', status: 'ACTIVE', passwordHash: sampleHash, passwordChangedAt: now, groupIds: [ib.id, upi.id] });
  user({ username: '140123', displayName: 'Abhash', source: 'LOCAL', level: 'WRITE', status: 'ACTIVE', passwordHash: sampleHash, passwordChangedAt: now, groupIds: [cb.id] });

  const record = (groupId: number, mappingType: MappingType, domain: string, ips: string[], ttl: number) => {
    const spec = validateSpec({ mappingType, domain, ips, ttl });
    const r: RecordRec = {
      id: nextId(db, 'record'),
      groupId,
      recordType: spec.recordType,
      mappingType: spec.mappingType,
      recordKey: spec.key,
      domain: spec.domain,
      ips: spec.ips,
      ptrName: spec.ptrName,
      ttl: spec.ttl,
      revision: FIRST_REVISION,
      status: 'ACTIVE',
      searchText: '',
      createdAt: now,
      createdBy: 'sample-data',
      updatedAt: now,
      updatedBy: 'sample-data',
    };
    r.searchText = searchTextOf(r);
    db.records.push(r);
    db.versions.push({ id: nextId(db, 'version'), recordId: r.id, revision: r.revision, snapshot: snapshotOf(db, r), deleted: false, changeRequestId: null, createdAt: now, createdBy: 'sample-data' });
  };
  record(ib.id, 'SINGLE', 'netbanking.bank.example', ['10.10.1.20'], 300);
  record(ib.id, 'MULTI', 'ib-api.bank.example', ['10.10.1.31', '10.10.1.32'], 300);
  record(cb.id, 'MULTI', 'cbs.bank.example', ['10.20.1.11', '10.20.1.12'], 600);
  record(cb.id, 'PTR', 'cbs.bank.example', ['10.20.1.11'], 600);
  record(upi.id, 'SINGLE', 'upi.bank.example', ['10.30.1.10'], 300);

  // Mock Bank directory: ID, name, email, password (no department or role, like the Bank's directory)
  for (const [uid, name, email] of [
    ['140124', 'Anoop Tiwari', 'anoop.tiwari@bank.local'],
    ['140125', 'Rahul KP', 'rahul.kp@bank.local'],
    ['140126', 'Paras Mahajan', 'paras.mahajan@bank.local'],
  ]) {
    db.directory.push({ uid, name, email, passwordHash: sampleHash });
  }

  const auditEvent = (action: string, targetType: string, targetId: string | null, details: Record<string, unknown> | null) =>
    db.audit.push({ id: nextId(db, 'audit'), at: now, actor: 'system', action, outcome: 'SUCCESS', targetType, targetId, details, clientIp: null, site: 'DC-1' });
  auditEvent('SAMPLE_DATA_LOADED', 'SYSTEM', null, { partitions: ['Internet_Banking', 'Core_Banking', 'UPI_Payments'], localUsers: ['140122', '140123'], records: 5 });
  auditEvent('ADMIN_BOOTSTRAPPED', 'USER', 'admin', { userId: 'admin', name: 'Portal Administrator' });
  return db;
}
