/** Request context, permission model, audit and response shapes (same JSON as the real portal API). */
import type { AccessLevel, UserSource, UserStatus } from '../types';
import { AUDIT_CAP, nowIso, nextId, type AccessReqRec, type CrRec, type Db, type RecordRec, type UserRec, type VersionRec } from './db';
import { unauthorized } from './errors';
import { formatVersion, m } from './rules';

// ---------------------------------------------------------------- the signed-in user (PortalPrincipal)

export interface Principal {
  id: number;
  username: string;
  displayName: string | null;
  level: AccessLevel;
  status: UserStatus;
  source: UserSource;
  mustChangePassword: boolean;
  groupIds: number[];
}

export const principalOf = (u: UserRec): Principal => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  level: u.level,
  status: u.status,
  source: u.source,
  mustChangePassword: u.mustChangePassword,
  groupIds: u.level === 'WRITE' ? [...u.groupIds] : [],
});

export const isAdmin = (p: Principal) => p.level === 'ADMIN';
export const isChecker = (p: Principal) => p.level === 'CHECKER' || p.level === 'ADMIN';
export const canWrite = (p: Principal) => p.level === 'WRITE' || isChecker(p);
export const seesAllGroups = (p: Principal) => p.level === 'READ' || isChecker(p);
export const canSeeGroup = (p: Principal, groupId: number) => seesAllGroups(p) || p.groupIds.includes(groupId);
export const canWriteGroup = (p: Principal, groupId: number) => isChecker(p) || (p.level === 'WRITE' && p.groupIds.includes(groupId));

/** Spring Security role of the user, as SessionUserFilter assigns it. */
export function roleOf(p: Principal): string {
  if (p.mustChangePassword) return 'PASSWORD_CHANGE';
  if (p.status === 'PENDING' || p.level === 'NONE') return 'PENDING';
  return p.level;
}

export interface Ctx {
  db: Db;
  me: Principal | null;
  query: URLSearchParams;
  body: Record<string, unknown>;
  /** Keep the changes even though the request fails (login failure counting, like noRollbackFor). */
  commitOnError: boolean;
  /** Writes that survive a failed request (denied-access audit, like REQUIRES_NEW). */
  deferred: ((db: Db) => void)[];
}

export function requireMe(ctx: Ctx): Principal {
  if (!ctx.me) throw unauthorized();
  return ctx.me;
}

// ---------------------------------------------------------------- finders

export const userById = (db: Db, id: number | null | undefined) => db.users.find((u) => u.id === id);
export const userByName = (db: Db, username: string) => db.users.find((u) => u.username === username);
export const groupById = (db: Db, id: number | null | undefined) => db.groups.find((g) => g.id === id);
export const recordById = (db: Db, id: number | null | undefined) => db.records.find((r) => r.id === id);
export const crById = (db: Db, id: number | null | undefined) => db.changeRequests.find((c) => c.id === id);
export const crNumber = (id: number | null | undefined) => (id === null || id === undefined ? null : `CR-${String(id).padStart(6, '0')}`);
export const isLocked = (u: UserRec) => !!u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();

// ---------------------------------------------------------------- audit (append-only)

type Outcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export function writeAudit(
  db: Db,
  actor: string | null,
  action: string,
  outcome: Outcome,
  targetType: string | null,
  targetId: unknown,
  details?: Record<string, unknown> | null,
): void {
  const target = targetId === null || targetId === undefined ? null : String(targetId);
  let d = details ? m(details) : null;
  // Every event about a user carries that user's ID and name.
  if (targetType === 'USER' && target && !(d && 'userId' in d)) {
    const u = userByName(db, target);
    if (u) d = { userId: u.username, ...(u.displayName && u.displayName !== u.username ? { name: u.displayName } : {}), ...(d ?? {}) };
  }
  db.audit.push({
    id: nextId(db, 'audit'),
    at: nowIso(),
    actor,
    action,
    outcome,
    targetType,
    targetId: target,
    details: d && Object.keys(d).length ? d : null,
    clientIp: 'this browser',
    site: db.settings.siteName,
  });
  if (db.audit.length > AUDIT_CAP) db.audit.splice(0, db.audit.length - AUDIT_CAP);
}

/** Event by the signed-in user. */
export function audit(ctx: Ctx, action: string, outcome: Outcome, targetType: string | null, targetId: unknown, details?: Record<string, unknown> | null) {
  writeAudit(ctx.db, ctx.me?.username ?? null, action, outcome, targetType, targetId, details);
}

/** Denied access: kept even though the request fails. */
export function auditDenied(ctx: Ctx, action: string, targetType: string, targetId: unknown, reason: string) {
  const actor = ctx.me?.username ?? null;
  const write = (db: Db) => writeAudit(db, actor, action, 'DENIED', targetType, targetId, { reason });
  write(ctx.db);
  ctx.deferred.push(write);
}

// ---------------------------------------------------------------- response shapes

export const ref = (db: Db, groupId: number) => {
  const g = db.groups.find((x) => x.id === groupId);
  return { id: groupId, name: g?.name ?? '(deleted)' };
};

const byName = (a: { name: string }, b: { name: string }) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

function userGroups(db: Db, u: UserRec) {
  return u.level === 'WRITE'
    ? u.groupIds
        .filter((id) => db.groups.some((g) => g.id === id))
        .map((id) => ref(db, id))
        .sort(byName)
    : [];
}

const allGroups = (level: AccessLevel) => level === 'READ' || level === 'CHECKER' || level === 'ADMIN';

export function meDto(db: Db, u: UserRec) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    department: u.department,
    source: u.source,
    level: u.level,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    allGroups: allGroups(u.level),
    groups: userGroups(db, u),
  };
}

export function userDto(db: Db, u: UserRec, accessRequest: unknown = null) {
  const locked = isLocked(u);
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    department: u.department,
    source: u.source,
    level: u.level,
    status: u.status,
    locked,
    lockedUntil: locked ? u.lockedUntil : null,
    mustChangePassword: u.mustChangePassword,
    allGroups: allGroups(u.level),
    groups: userGroups(db, u),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    createdBy: u.createdBy,
    managedByConfig: u.source === 'CONFIG',
    accessRequest,
  };
}

export function accessRequestDto(db: Db, r: AccessReqRec) {
  return {
    id: r.id,
    department: r.department,
    requestedLevel: r.requestedLevel,
    requestedGroups: r.requestedGroupIds
      .filter((id) => db.groups.some((g) => g.id === id))
      .map((id) => ref(db, id))
      .sort(byName),
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
  };
}

const userRef = (db: Db, id: number | null) => {
  const u = userById(db, id);
  return u ? { id: u.id, username: u.username, displayName: u.displayName } : null;
};

export function crDto(db: Db, c: CrRec, me: Principal) {
  const pending = c.status === 'PENDING_APPROVAL';
  const open = pending || c.status === 'SCHEDULED';
  const mine = c.makerId === me.id;
  return {
    id: c.id,
    number: crNumber(c.id),
    operation: c.operation,
    status: c.status,
    direct: c.direct,
    group: ref(db, c.groupId),
    recordId: c.recordId,
    recordType: c.recordType,
    recordKey: c.recordKey,
    baseVersion: formatVersion(c.baseRevision),
    targetVersion: formatVersion(c.targetRevision),
    proposed: c.proposed,
    previous: c.previous,
    reason: c.reason,
    itsmRef: c.itsmRef,
    scheduledAt: c.scheduledAt,
    maker: userRef(db, c.makerId),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    decidedBy: userRef(db, c.decidedById),
    decidedAt: c.decidedAt,
    decisionComment: c.decisionComment,
    executedAt: c.executedAt,
    executionResult: c.executionResult,
    errorMessage: c.errorMessage,
    resultVersion: formatVersion(c.resultRevision),
    canApprove: pending && !mine && isChecker(me),
    canEdit: open && mine,
    canCancel: (open || c.status === 'HELD') && mine,
    canConfirm: c.status === 'HELD' && isAdmin(me),
  };
}

export function recordDto(db: Db, r: RecordRec, pending: CrRec | undefined, scheduled: CrRec | undefined, me: Principal) {
  return {
    id: r.id,
    group: ref(db, r.groupId),
    recordType: r.recordType,
    mappingType: r.mappingType,
    key: r.recordKey,
    domain: r.domain,
    ips: [...r.ips],
    ptrName: r.ptrName,
    ttl: r.ttl,
    version: formatVersion(r.revision),
    status: r.status,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    pending: pending ? { id: pending.id, number: crNumber(pending.id), operation: pending.operation } : null,
    scheduled: scheduled
      ? { id: scheduled.id, number: crNumber(scheduled.id), operation: scheduled.operation, status: scheduled.status, scheduledAt: scheduled.scheduledAt }
      : null,
    canChange: r.status === 'ACTIVE' && !pending && canWriteGroup(me, r.groupId),
    canRollback: isAdmin(me),
  };
}

export function versionDto(db: Db, v: VersionRec) {
  const cr = crById(db, v.changeRequestId);
  return {
    version: formatVersion(v.revision),
    deleted: v.deleted,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
    changeRequestId: cr ? cr.id : null,
    changeRequestNumber: cr ? crNumber(cr.id) : null,
    operation: cr ? cr.operation : null,
    restoredFrom: cr ? formatVersion(cr.targetRevision) : null,
    snapshot: v.snapshot,
  };
}
