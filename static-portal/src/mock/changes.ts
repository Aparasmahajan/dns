/**
 * DNS records and changes (port of RecordService, ChangeRequestService, ChangeExecutor, ChangeScheduler and the
 * dashboard). Same rules as the real portal:
 *   - Write user -> request waits for a Checker/Admin; Checker/Admin -> direct change.
 *   - Changes to existing records can be scheduled; a new record cannot.
 *   - Nobody approves their own request; a rejection needs a comment.
 *   - At execution the record must still be at the version the change was prepared against.
 *   - Admin rollback to any earlier version (also restores deleted records); a scheduled rollback whose record
 *     changed meanwhile is HELD for the Admin.
 *   - F5 is a mock: a domain ending with the failure suffix (default .fail.test) fails at the DR site.
 */
import type { CrStatus, Operation, SiteResult } from '../types';
import { listVisibleGroups } from './admin';
import {
  audit,
  auditDenied,
  canSeeGroup,
  canWrite,
  canWriteGroup,
  crById,
  crDto,
  crNumber,
  groupById,
  isAdmin,
  isChecker,
  recordById,
  recordDto,
  requireMe,
  seesAllGroups,
  userById,
  versionDto,
  writeAudit,
  type Ctx,
  type Principal,
} from './context';
import { nextId, nowIso, searchTextOf, snapshotOf, storageBytes, type CrRec, type Db, type RecordRec } from './db';
import { badRequest, conflict, forbidden, notFound } from './errors';
import {
  clean,
  FIRST_REVISION,
  formatVersion,
  m,
  paginate,
  parseVersion,
  sameAs,
  specFromMap,
  specToMap,
  validateSpec,
  type DnsSpec,
  type RecordSpecInput,
} from './rules';

const SITES = ['DC', 'DR', 'AZ'];
const MIN_LEAD_SECONDS = 60;
const MAX_DAYS_AHEAD = 90;
export const SCHEDULER_POLL_MS = 15_000;
/** Only updates (MODIFY) and Admin rollbacks can be scheduled; create and delete run at once or on approval. */
const ONLY_UPDATES_SCHEDULED =
  'Only updates to an existing record (and Admin rollbacks) can be scheduled. Creating or deleting a record runs straight away, or as soon as a Checker approves it.';

// ---------------------------------------------------------------- helpers

const crVisible = (me: Principal, c: CrRec) => seesAllGroups(me) || c.makerId === me.id || me.groupIds.includes(c.groupId);
const pendingFor = (db: Db, recordId: number) => db.changeRequests.find((c) => c.status === 'PENDING_APPROVAL' && c.recordId === recordId);
const scheduledFor = (db: Db, recordId: number) =>
  db.changeRequests
    .filter((c) => (c.status === 'SCHEDULED' || c.status === 'HELD') && c.recordId === recordId)
    .sort((a, b) => (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999'))[0];
const activeExists = (db: Db, type: string, key: string) => db.records.some((r) => r.recordType === type && r.recordKey === key && r.status === 'ACTIVE');
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

function loadCr(db: Db, id: number): CrRec {
  const c = crById(db, id);
  if (!c) throw notFound('Change request not found.');
  return c;
}

function loadActiveRecord(db: Db, id: unknown): RecordRec {
  if (id === null || id === undefined) throw badRequest('Choose the record to change.');
  const r = recordById(db, Number(id));
  if (!r) throw notFound('DNS record not found.');
  if (r.status !== 'ACTIVE') throw conflict('This record has been deleted.');
  return r;
}

function requireReason(reason: unknown): string {
  const t = clean(reason, 1000);
  if (!t) throw badRequest('Give a reason for this change.');
  return t;
}

function cleanItsm(itsm: unknown): string | null {
  const t = clean(itsm, 100);
  if (t && !/^[A-Za-z0-9._/-]+$/.test(t)) throw badRequest('The ITSM reference can contain letters, digits and . _ / - only.');
  return t;
}

function parseInstant(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw badRequest('The request is not valid.');
  return d;
}

/** Null = run immediately. Otherwise at least 1 minute and at most 90 days ahead. */
function checkSchedule(value: unknown): string | null {
  const at = parseInstant(value);
  if (!at) return null;
  if (at.getTime() < Date.now() + MIN_LEAD_SECONDS * 1000) throw badRequest('Choose a time at least 1 minute from now, or run the change immediately.');
  if (at.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw badRequest(`A change can be scheduled at most ${MAX_DAYS_AHEAD} days ahead.`);
  at.setMilliseconds(0);
  return at.toISOString();
}

function requireWriteAccess(ctx: Ctx, me: Principal, groupId: number) {
  if (!canWriteGroup(me, groupId)) {
    auditDenied(ctx, 'CR_SUBMIT', 'GROUP', groupById(ctx.db, groupId)?.name ?? groupId, 'group not assigned to user');
    throw forbidden('You can only raise changes in the partitions assigned to you.');
  }
}

function requireVisible(ctx: Ctx, me: Principal, c: CrRec) {
  if (c.makerId !== me.id && !canSeeGroup(me, c.groupId)) {
    auditDenied(ctx, 'CR_VIEW', 'CHANGE_REQUEST', crNumber(c.id), 'group not assigned to user');
    throw forbidden("You do not have access to this request's partition.");
  }
}

const notOpen = (c: CrRec) => `This request can no longer be changed (it is ${c.status.toLowerCase().replace('_', ' ')}).`;

function requirePending(c: CrRec) {
  if (c.status !== 'PENDING_APPROVAL') throw conflict(notOpen(c));
}

function ensureNoActiveRecord(db: Db, spec: DnsSpec) {
  if (activeExists(db, spec.recordType, spec.key)) {
    throw conflict(`${spec.recordType === 'A' ? `A record for ${spec.key}` : `A PTR record for ${spec.key}`} already exists. Modify the existing record instead.`);
  }
}

function ensureNoPendingRequest(db: Db, type: string, key: string, excludeId: number | null) {
  const p = db.changeRequests.find((c) => c.status === 'PENDING_APPROVAL' && c.recordType === type && c.recordKey === key && c.id !== excludeId);
  if (p) throw conflict(`Request ${crNumber(p.id)} is already pending for ${key}. Wait for it to be decided, or cancel it first.`);
}

function ensureSameKey(record: RecordRec, spec: DnsSpec) {
  if (spec.recordType !== record.recordType) {
    throw badRequest(
      record.recordType === 'PTR'
        ? 'A PTR record cannot be turned into a domain → IP mapping. Delete it and create a new record.'
        : 'A domain → IP record cannot be turned into a PTR record. Delete it and create a new record.',
    );
  }
  if (spec.key !== record.recordKey) {
    throw badRequest(
      record.recordType === 'A'
        ? 'The domain name of an existing record cannot be changed. Delete it and create a new record.'
        : 'The IP address of an existing PTR record cannot be changed. Delete it and create a new record.',
    );
  }
}

function requireRecordUnchanged(db: Db, c: CrRec) {
  const r = recordById(db, c.recordId);
  if (r && r.revision !== c.baseRevision) {
    throw conflict(`The record has changed since this request was raised (it is now v${formatVersion(r.revision)}). Cancel this request and raise a new one.`);
  }
}

function bindRecord(db: Db, c: CrRec, r: RecordRec) {
  c.groupId = r.groupId;
  c.recordId = r.id;
  c.baseRevision = r.revision;
  c.previous = snapshotOf(db, r);
  c.recordType = r.recordType;
  c.recordKey = r.recordKey;
}

function describe(db: Db, c: CrRec) {
  return m({
    operation: c.operation,
    record: c.recordKey,
    group: groupById(db, c.groupId)?.name,
    direct: c.direct,
    proposed: c.proposed,
    restoredFrom: formatVersion(c.targetRevision),
    scheduledFor: c.scheduledAt,
    reason: c.reason,
    itsmRef: c.itsmRef,
  });
}

function newCr(me: Principal, operation: Operation): CrRec {
  const now = nowIso();
  return {
    id: 0,
    operation,
    status: 'PENDING_APPROVAL',
    direct: false,
    groupId: 0,
    recordId: null,
    recordType: 'A',
    recordKey: '',
    baseRevision: null,
    resultRevision: null,
    targetRevision: null,
    scheduledAt: null,
    proposed: null,
    previous: null,
    reason: '',
    itsmRef: null,
    makerId: me.id,
    createdAt: now,
    updatedAt: now,
    decidedById: null,
    decidedAt: null,
    decisionComment: null,
    executedAt: null,
    executionResult: null,
    errorMessage: null,
  };
}

function save(ctx: Ctx, c: CrRec) {
  if (!c.id) {
    c.id = nextId(ctx.db, 'changeRequest');
    ctx.db.changeRequests.push(c);
  }
  c.updatedAt = nowIso();
}

// ---------------------------------------------------------------- records

export function listRecords(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const q = ctx.query;
  const groupId = q.get('groupId') ? Number(q.get('groupId')) : null;
  if (groupId !== null && !canSeeGroup(me, groupId)) {
    auditDenied(ctx, 'RECORD_LIST', 'GROUP', groupId, 'group not assigned to user');
    throw forbidden('You do not have access to this partition.');
  }
  const status = q.get('status') === 'DELETED' ? 'DELETED' : 'ACTIVE';
  const type = q.get('type');
  const term = (q.get('q') ?? '').trim().toLowerCase();
  const items = db.records
    .filter(
      (r) =>
        r.status === status &&
        canSeeGroup(me, r.groupId) &&
        (groupId === null || r.groupId === groupId) &&
        (!type || r.mappingType === type) &&
        (!term || r.searchText.includes(term)),
    )
    .sort((a, b) => a.recordType.localeCompare(b.recordType) || a.recordKey.localeCompare(b.recordKey));
  const page = paginate(items, q.get('page'), q.get('size'), 25);
  return { ...page, content: page.content.map((r) => recordDto(db, r, pendingFor(db, r.id), scheduledFor(db, r.id), me)) };
}

export function getRecord(ctx: Ctx, id: number) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const r = recordById(db, id);
  if (!r) throw notFound('DNS record not found.');
  if (!canSeeGroup(me, r.groupId)) {
    auditDenied(ctx, 'RECORD_VIEW', 'DNS_RECORD', r.recordKey, 'group not assigned to user');
    throw forbidden("You do not have access to this record's partition.");
  }
  const versions = db.versions
    .filter((v) => v.recordId === id)
    .sort((a, b) => b.revision - a.revision)
    .map((v) => versionDto(db, v));
  return { record: recordDto(db, r, pendingFor(db, r.id), scheduledFor(db, r.id), me), versions };
}

// ---------------------------------------------------------------- change requests: queries

export function listRequests(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const q = ctx.query;
  let items: CrRec[];
  let sort = (a: CrRec, b: CrRec) => b.id - a.id;
  switch (q.get('scope') ?? 'all') {
    case 'approvals':
      if (!isChecker(me)) throw forbidden('Only Checkers and the Admin have an approval queue.');
      items = db.changeRequests.filter((c) => c.status === 'PENDING_APPROVAL' && c.makerId !== me.id);
      break;
    case 'mine':
      items = db.changeRequests.filter((c) => c.makerId === me.id);
      break;
    case 'scheduled':
      items = db.changeRequests.filter((c) => crVisible(me, c) && (c.status === 'SCHEDULED' || c.status === 'HELD'));
      sort = (a, b) => (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999') || a.id - b.id;
      break;
    default:
      items = db.changeRequests.filter((c) => crVisible(me, c));
  }
  const status = q.get('status');
  if (status) items = items.filter((c) => c.status === status);
  const term = (q.get('q') ?? '').trim().toLowerCase();
  if (term) items = items.filter((c) => c.recordKey.toLowerCase().includes(term));
  const page = paginate(items.sort(sort), q.get('page'), q.get('size'), 25);
  return { ...page, content: page.content.map((c) => crDto(db, c, me)) };
}

export function getRequest(ctx: Ctx, id: number) {
  const me = requireMe(ctx);
  const c = loadCr(ctx.db, id);
  requireVisible(ctx, me, c);
  return crDto(ctx.db, c, me);
}

// ---------------------------------------------------------------- maker actions

export function submit(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const b = ctx.body;
  if (!canWrite(me)) {
    auditDenied(ctx, 'CR_SUBMIT', 'DNS_RECORD', null, 'read-only user');
    throw forbidden('Your access is Read only. Ask the Admin for Write access to raise changes.');
  }
  const operation = b.operation as Operation | undefined;
  if (!operation || !['CREATE', 'MODIFY', 'DELETE', 'ROLLBACK'].includes(operation)) throw badRequest('Choose an operation: create, modify or delete.');
  if (operation === 'ROLLBACK') throw badRequest("A rollback is started by the Admin from the record's version history.");

  const c = newCr(me, operation);
  c.reason = requireReason(b.reason);
  c.itsmRef = cleanItsm(b.itsmRef);
  if ((operation === 'CREATE' || operation === 'DELETE') && b.scheduledAt) throw badRequest(ONLY_UPDATES_SCHEDULED);
  c.scheduledAt = checkSchedule(b.scheduledAt);

  if (operation === 'CREATE') {
    if (b.groupId === null || b.groupId === undefined) throw badRequest('Choose the partition that will own this record.');
    const group = groupById(db, Number(b.groupId));
    if (!group) throw notFound('Partition not found.');
    requireWriteAccess(ctx, me, group.id);
    const spec = validateSpec(b.spec as RecordSpecInput);
    ensureNoActiveRecord(db, spec);
    c.groupId = group.id;
    c.recordType = spec.recordType;
    c.recordKey = spec.key;
    c.proposed = specToMap(spec);
  } else if (operation === 'MODIFY') {
    const r = loadActiveRecord(db, b.recordId);
    requireWriteAccess(ctx, me, r.groupId);
    const spec = validateSpec(b.spec as RecordSpecInput);
    ensureSameKey(r, spec);
    if (sameAs(spec, r)) throw badRequest('Nothing has changed. Edit the addresses, target or TTL first.');
    bindRecord(db, c, r);
    c.proposed = specToMap(spec);
  } else {
    const r = loadActiveRecord(db, b.recordId);
    requireWriteAccess(ctx, me, r.groupId);
    bindRecord(db, c, r);
  }

  ensureNoPendingRequest(db, c.recordType, c.recordKey, null);
  c.direct = isChecker(me);
  if (c.direct && c.scheduledAt) {
    c.status = 'SCHEDULED';
    save(ctx, c);
    audit(ctx, 'DIRECT_CHANGE_SCHEDULED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), describe(db, c));
  } else {
    c.status = 'PENDING_APPROVAL';
    save(ctx, c);
    if (c.direct) {
      audit(ctx, 'DIRECT_CHANGE_SUBMITTED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), describe(db, c));
      execute(db, c, me.username, false);
    } else {
      audit(ctx, 'CR_SUBMITTED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), describe(db, c));
    }
  }
  return crDto(db, c, me);
}

export function update(ctx: Ctx, id: number) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const b = ctx.body;
  const c = loadCr(db, id);
  requireVisible(ctx, me, c);
  if (c.makerId !== me.id) throw forbidden('Only the maker of a request can edit it.');
  if (c.status !== 'PENDING_APPROVAL' && c.status !== 'SCHEDULED') throw conflict(notOpen(c));
  if (c.operation === 'ROLLBACK') {
    if (!isAdmin(me)) {
      auditDenied(ctx, 'ROLLBACK_UPDATE', 'DNS_RECORD', crNumber(c.id), 'not the Admin');
      throw forbidden('Only the Admin can compare versions and roll back records.');
    }
  } else requireWriteAccess(ctx, me, c.groupId);
  const before: CrStatus = c.status;

  c.reason = requireReason(b.reason);
  c.itsmRef = cleanItsm(b.itsmRef);
  if ((c.operation === 'CREATE' || c.operation === 'DELETE') && b.scheduledAt) throw badRequest(ONLY_UPDATES_SCHEDULED);
  const scheduledAt = checkSchedule(b.scheduledAt);
  if (c.operation === 'CREATE') {
    const spec = validateSpec(b.spec as RecordSpecInput);
    ensureNoActiveRecord(db, spec);
    c.recordType = spec.recordType;
    c.recordKey = spec.key;
    c.proposed = specToMap(spec);
  } else if (c.operation === 'MODIFY') {
    requireRecordUnchanged(db, c);
    const record = recordById(db, c.recordId)!;
    const spec = validateSpec(b.spec as RecordSpecInput);
    ensureSameKey(record, spec);
    if (sameAs(spec, record)) throw badRequest('Nothing has changed compared with the current record.');
    c.proposed = specToMap(spec);
  } else {
    requireRecordUnchanged(db, c);
  }
  c.scheduledAt = scheduledAt;

  let runNow = false;
  let backToApproval = false;
  if (c.direct) {
    if (!scheduledAt) {
      ensureNoPendingRequest(db, c.recordType, c.recordKey, c.id);
      c.status = 'PENDING_APPROVAL';
      runNow = true;
    } else c.status = 'SCHEDULED';
  } else {
    ensureNoPendingRequest(db, c.recordType, c.recordKey, c.id);
    if (before === 'SCHEDULED') {
      backToApproval = true;
      c.decidedById = null;
      c.decidedAt = null;
      c.decisionComment = null;
    }
    c.status = 'PENDING_APPROVAL';
  }
  save(ctx, c);
  audit(ctx, 'CR_UPDATED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), { ...describe(db, c), ...(backToApproval ? { returnedForApproval: true } : {}) });
  if (runNow) execute(db, c, me.username, false);
  return crDto(db, c, me);
}

export function cancel(ctx: Ctx, id: number) {
  const me = requireMe(ctx);
  const c = loadCr(ctx.db, id);
  requireVisible(ctx, me, c);
  if (c.makerId !== me.id) throw forbidden('Only the maker of a request can cancel it.');
  if (!['PENDING_APPROVAL', 'SCHEDULED', 'HELD'].includes(c.status)) throw conflict(notOpen(c));
  const before = c.status;
  c.status = 'CANCELLED';
  c.decidedAt = nowIso();
  save(ctx, c);
  audit(ctx, 'CR_CANCELLED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), { ...describe(ctx.db, c), previousStatus: before });
  return crDto(ctx.db, c, me);
}

// ---------------------------------------------------------------- checker actions

export function approve(ctx: Ctx, id: number) {
  const me = requireMe(ctx);
  const db = ctx.db;
  if (!isChecker(me)) {
    auditDenied(ctx, 'CR_APPROVE', 'CHANGE_REQUEST', crNumber(id), 'not a checker');
    throw forbidden('Only Checkers and the Admin can approve requests.');
  }
  const c = loadCr(db, id);
  requirePending(c);
  if (c.makerId === me.id) {
    auditDenied(ctx, 'CR_APPROVE', 'CHANGE_REQUEST', crNumber(c.id), 'own request');
    throw forbidden('You cannot approve your own request.');
  }
  const runAt = c.scheduledAt;
  if (runAt && time(runAt) <= Date.now()) {
    throw conflict('The scheduled time of this request has passed. The maker needs to choose a new time (or run it immediately) before it can be approved.');
  }
  c.decidedById = me.id;
  c.decidedAt = nowIso();
  c.decisionComment = clean(ctx.body.comment, 1000);
  audit(ctx, 'CR_APPROVED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), m({ comment: c.decisionComment, maker: userById(db, c.makerId)?.username, scheduledFor: runAt }));
  if (!runAt) execute(db, c, me.username, false);
  else {
    const blocker = precheck(db, c);
    if (blocker) markFailed(db, c, blocker.message, null, me.username);
    else {
      c.status = 'SCHEDULED';
      audit(ctx, 'CR_SCHEDULED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), { scheduledFor: runAt, approvedBy: me.username });
    }
  }
  save(ctx, c);
  return crDto(db, c, me);
}

export function reject(ctx: Ctx, id: number) {
  const me = requireMe(ctx);
  const db = ctx.db;
  if (!isChecker(me)) {
    auditDenied(ctx, 'CR_REJECT', 'CHANGE_REQUEST', crNumber(id), 'not a checker');
    throw forbidden('Only Checkers and the Admin can reject requests.');
  }
  const text = clean(ctx.body.comment, 1000);
  if (!text) throw badRequest('A rejection needs a comment for the maker.');
  const c = loadCr(db, id);
  requirePending(c);
  if (c.makerId === me.id) throw forbidden('Cancel your own request instead of rejecting it.');
  c.status = 'REJECTED';
  c.decidedById = me.id;
  c.decidedAt = nowIso();
  c.decisionComment = text;
  save(ctx, c);
  audit(ctx, 'CR_REJECTED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), { comment: text, maker: userById(db, c.makerId)?.username });
  return crDto(db, c, me);
}

// ---------------------------------------------------------------- Admin: version rollback

function requireAdmin(ctx: Ctx, action: string, target: unknown): Principal {
  const me = requireMe(ctx);
  if (!isAdmin(me)) {
    auditDenied(ctx, action, 'DNS_RECORD', target, 'not the Admin');
    throw forbidden('Only the Admin can compare versions and roll back records.');
  }
  return me;
}

function loadTarget(db: Db, r: RecordRec, toVersion: unknown) {
  const revision = parseVersion(typeof toVersion === 'string' ? toVersion : null);
  if (revision === null) throw badRequest('Choose the version to roll back to, for example 1.1.');
  const target = db.versions.find((v) => v.recordId === r.id && v.revision === revision);
  if (!target) throw notFound(`This record has no version v${formatVersion(revision)}.`);
  if (target.deleted) throw badRequest(`v${formatVersion(revision)} is the deletion of the record. Choose a version with a configuration to restore.`);
  if (revision === r.revision) throw badRequest(`v${formatVersion(revision)} is the current version. Choose an earlier version.`);
  return target;
}

function targetSpec(target: { snapshot: Record<string, unknown> }): DnsSpec {
  const saved = specFromMap(target.snapshot);
  return validateSpec({ mappingType: saved.mappingType, domain: saved.domain, ips: saved.ips, ttl: saved.ttl });
}

function rollbackBlocker(db: Db, r: RecordRec, spec: DnsSpec, targetRevision: number): string | null {
  const pending = db.changeRequests.find((c) => c.status === 'PENDING_APPROVAL' && c.recordType === r.recordType && c.recordKey === r.recordKey);
  if (pending) return `Request ${crNumber(pending.id)} is waiting for approval for this record. Reject it, or wait until it is decided, before rolling back.`;
  if (r.status === 'ACTIVE' && sameAs(spec, r)) return `The record already has the same configuration as v${formatVersion(targetRevision)}.`;
  if (r.status === 'DELETED' && activeExists(db, r.recordType, r.recordKey)) return `Another active record for ${r.recordKey} exists, so this deleted record cannot be restored.`;
  return null;
}

export function rollbackPreview(ctx: Ctx, recordId: number) {
  requireAdmin(ctx, 'ROLLBACK_PREVIEW', recordId);
  const db = ctx.db;
  const r = recordById(db, recordId);
  if (!r) throw notFound('DNS record not found.');
  const target = loadTarget(db, r, ctx.query.get('toVersion'));
  const spec = targetSpec(target);
  return {
    recordId: r.id,
    recordKey: r.recordKey,
    recordStatus: r.status,
    currentVersion: formatVersion(r.revision),
    targetVersion: formatVersion(target.revision),
    resultVersion: formatVersion(r.revision + 1),
    current: snapshotOf(db, r),
    target: target.snapshot,
    live: checkLive(),
    blocker: rollbackBlocker(db, r, spec, target.revision),
  };
}

export function rollback(ctx: Ctx, recordId: number) {
  const me = requireAdmin(ctx, 'ROLLBACK', recordId);
  const db = ctx.db;
  const b = ctx.body;
  const r = recordById(db, recordId);
  if (!r) throw notFound('DNS record not found.');
  const target = loadTarget(db, r, b.toVersion);
  const spec = targetSpec(target);
  const blocker = rollbackBlocker(db, r, spec, target.revision);
  if (blocker) throw conflict(blocker);

  const c = newCr(me, 'ROLLBACK');
  c.direct = true;
  c.reason = requireReason(b.reason);
  c.itsmRef = cleanItsm(b.itsmRef);
  c.scheduledAt = checkSchedule(b.scheduledAt);
  bindRecord(db, c, r);
  c.proposed = specToMap(spec);
  c.targetRevision = target.revision;
  if (c.scheduledAt) {
    c.status = 'SCHEDULED';
    save(ctx, c);
    audit(ctx, 'ROLLBACK_SCHEDULED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), describe(db, c));
  } else {
    c.status = 'PENDING_APPROVAL';
    save(ctx, c);
    audit(ctx, 'ROLLBACK_SUBMITTED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), describe(db, c));
    execute(db, c, me.username, false);
  }
  return crDto(db, c, me);
}

/** A held rollback: the Admin has reviewed the difference and runs it now against the current record. */
export function confirmHeld(ctx: Ctx, id: number) {
  const me = requireAdmin(ctx, 'ROLLBACK_CONFIRM', crNumber(id));
  const db = ctx.db;
  const c = loadCr(db, id);
  if (c.status !== 'HELD') throw conflict(notOpen(c));
  const r = recordById(db, c.recordId)!;
  const heldBecause = c.errorMessage;
  c.baseRevision = r.revision;
  c.previous = snapshotOf(db, r);
  c.errorMessage = null;
  audit(ctx, 'ROLLBACK_CONFIRMED', 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), {
    record: c.recordKey,
    heldBecause,
    currentVersion: formatVersion(r.revision),
    restoredFrom: formatVersion(c.targetRevision),
  });
  execute(db, c, me.username, true);
  save(ctx, c);
  return crDto(db, c, me);
}

// ---------------------------------------------------------------- execution engine (ChangeExecutor)

interface Blocker {
  message: string;
  stale: boolean;
}

/** Mock F5: in the real portal this reads the live configuration from F5 to spot changes made directly on F5. */
function checkLive() {
  return {
    status: 'NOT_CHECKED' as const,
    message:
      'Static demo: F5 is not connected, so the live configuration was not read. Once F5 is connected, the portal compares it with the latest portal version and flags any change made directly on F5.',
  };
}

function provision(db: Db, c: CrRec): SiteResult[] {
  const source = c.proposed ?? c.previous;
  const domain = source && source.domain ? String(source.domain) : null;
  const suffix = db.settings.f5FailSuffix.trim().toLowerCase();
  const fail = !!suffix && !!domain && domain.endsWith(suffix);
  return SITES.map((site, i) =>
    fail && i === 1
      ? { site, success: false, code: 400, message: `Simulated F5 error (mock mode): configuration rejected for ${domain}.` }
      : { site, success: true, code: 200, message: 'Mock mode: change accepted (not sent to F5).' },
  );
}

function checkMaker(db: Db, c: CrRec): Blocker | null {
  const maker = userById(db, c.makerId);
  if (!maker || maker.status !== 'ACTIVE') return { message: `The account that raised this change (${maker?.username ?? '?'}) is no longer active, so the change was not run.`, stale: false };
  const checker = maker.level === 'CHECKER' || maker.level === 'ADMIN';
  if (c.direct && !checker) return { message: `${maker.username} no longer has Checker access, so this direct change was not run. Raise it again.`, stale: false };
  if (c.operation === 'ROLLBACK' && maker.level !== 'ADMIN') return { message: 'Only the Admin can roll back a record.', stale: false };
  return null;
}

export function precheck(db: Db, c: CrRec): Blocker | null {
  const makerBlocker = checkMaker(db, c);
  if (makerBlocker) return makerBlocker;
  if (c.operation === 'CREATE') {
    return activeExists(db, c.recordType, c.recordKey) ? { message: `A record for ${c.recordKey} was created after this request was raised.`, stale: false } : null;
  }
  const r = recordById(db, c.recordId);
  if (!r) return { message: 'The record no longer exists.', stale: false };
  if (c.operation === 'ROLLBACK') {
    if (r.revision !== c.baseRevision) {
      return {
        message: `The record was changed after this rollback was prepared: it is now v${formatVersion(r.revision)}, and the rollback was prepared against v${formatVersion(c.baseRevision)}.`,
        stale: true,
      };
    }
    if (r.status === 'DELETED' && activeExists(db, r.recordType, r.recordKey)) {
      return { message: `Another active record for ${r.recordKey} exists, so the deleted record cannot be restored.`, stale: false };
    }
    if (r.status === 'ACTIVE' && c.proposed && sameAs(specFromMap(c.proposed), r)) {
      return { message: `The record already has the configuration of v${formatVersion(c.targetRevision)}.`, stale: false };
    }
    return null;
  }
  if (r.status !== 'ACTIVE') return { message: 'The record was deleted after this request was raised.', stale: false };
  if (r.revision !== c.baseRevision) {
    return { message: `The record was changed after this request was raised (it is now v${formatVersion(r.revision)}). Raise a new request.`, stale: true };
  }
  return null;
}

function applySpec(r: RecordRec, spec: DnsSpec) {
  r.recordType = spec.recordType;
  r.mappingType = spec.mappingType;
  r.recordKey = spec.key;
  r.domain = spec.domain;
  r.ips = [...spec.ips];
  r.ptrName = spec.ptrName;
  r.ttl = spec.ttl;
  r.searchText = searchTextOf(r);
}

function execute(db: Db, c: CrRec, actor: string, confirmed: boolean) {
  const blocker = precheck(db, c);
  if (blocker) {
    if (c.operation === 'ROLLBACK' && blocker.stale && !confirmed) hold(db, c, blocker.message, actor);
    else markFailed(db, c, blocker.message, null, actor);
    return;
  }
  // checkLive() is NOT_CHECKED in the static demo, so a rollback is never held for drift here.

  const results = provision(db, c);
  c.executedAt = nowIso();
  c.executionResult = results;
  const failedSites = results.filter((r) => !r.success).map((r) => r.site);
  if (failedSites.length) {
    markFailed(db, c, `F5 did not accept the change at ${failedSites.join(', ')}. See the error returned for each site.`, results, actor);
    return;
  }

  const maker = userById(db, c.makerId)!.username;
  const now = nowIso();
  let r: RecordRec;
  if (c.operation === 'CREATE') {
    r = {
      id: nextId(db, 'record'),
      groupId: c.groupId,
      recordType: 'A',
      mappingType: 'SINGLE',
      recordKey: '',
      domain: '',
      ips: [],
      ptrName: null,
      ttl: 0,
      revision: FIRST_REVISION,
      status: 'ACTIVE',
      searchText: '',
      createdAt: now,
      createdBy: maker,
      updatedAt: now,
      updatedBy: maker,
    };
    applySpec(r, specFromMap(c.proposed!));
    db.records.push(r);
  } else {
    r = recordById(db, c.recordId)!;
    if (c.operation === 'DELETE') r.status = 'DELETED';
    else {
      applySpec(r, specFromMap(c.proposed!));
      r.status = 'ACTIVE'; // a rollback also restores a deleted record
    }
    r.revision += 1;
    r.updatedBy = maker;
    r.updatedAt = now;
  }
  c.recordId = r.id;
  c.resultRevision = r.revision;
  c.errorMessage = null;
  db.versions.push({
    id: nextId(db, 'version'),
    recordId: r.id,
    revision: r.revision,
    snapshot: snapshotOf(db, r),
    deleted: c.operation === 'DELETE',
    changeRequestId: c.id,
    createdAt: now,
    createdBy: maker,
  });
  c.status = 'APPLIED';
  c.updatedAt = now;
  const action = c.operation === 'ROLLBACK' ? 'ROLLBACK_APPLIED' : c.direct ? 'DIRECT_CHANGE_APPLIED' : 'CR_APPLIED';
  writeAudit(db, actor, action, 'SUCCESS', 'CHANGE_REQUEST', crNumber(c.id), {
    operation: c.operation,
    record: c.recordKey,
    group: groupById(db, c.groupId)?.name,
    version: formatVersion(r.revision),
    restoredFrom: formatVersion(c.targetRevision),
    maker,
    approvedBy: c.direct ? null : userById(db, c.decidedById)?.username,
    scheduledFor: c.scheduledAt,
    siteResults: c.executionResult,
  });
}

function markFailed(db: Db, c: CrRec, message: string, results: SiteResult[] | null, actor: string) {
  c.status = 'FAILED';
  c.errorMessage = message;
  c.executedAt = c.executedAt ?? nowIso();
  c.updatedAt = nowIso();
  writeAudit(db, actor, c.operation === 'ROLLBACK' ? 'ROLLBACK_FAILED' : 'CR_FAILED', 'FAILURE', 'CHANGE_REQUEST', crNumber(c.id), {
    operation: c.operation,
    record: c.recordKey,
    error: message,
    scheduledFor: c.scheduledAt,
    siteResults: results,
  });
}

function hold(db: Db, c: CrRec, message: string, actor: string) {
  c.status = 'HELD';
  c.errorMessage = message;
  c.updatedAt = nowIso();
  writeAudit(db, actor, 'ROLLBACK_HELD', 'FAILURE', 'CHANGE_REQUEST', crNumber(c.id), { record: c.recordKey, reason: message, scheduledFor: c.scheduledAt });
}

// ---------------------------------------------------------------- scheduler (runs in the browser while the portal is open)

/** Runs due scheduled changes. Only on the Active site, like the real portal. Returns how many ran. */
export function runDueJobs(db: Db): number {
  if (db.settings.siteRole !== 'Active') return 0;
  const now = Date.now();
  const due = db.changeRequests
    .filter((c) => c.status === 'SCHEDULED' && c.scheduledAt && time(c.scheduledAt) <= now)
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .slice(0, 50);
  for (const c of due) {
    try {
      execute(db, c, 'scheduler', false);
    } catch (e) {
      console.error('Scheduled change could not be run', crNumber(c.id), e);
      markFailed(db, c, 'The portal could not run this scheduled change because of an internal error. It has been logged. Raise the change again.', null, 'scheduler');
    }
  }
  return due.length;
}

// ---------------------------------------------------------------- dashboard

function counters(db: Db, me: Principal) {
  return {
    awaitingApproval: isChecker(me) ? db.changeRequests.filter((c) => c.status === 'PENDING_APPROVAL' && c.makerId !== me.id).length : null,
    myPending: db.changeRequests.filter((c) => c.status === 'PENDING_APPROVAL' && c.makerId === me.id).length,
    scheduled: db.changeRequests.filter((c) => c.status === 'SCHEDULED' && crVisible(me, c)).length,
    held: isAdmin(me) ? db.changeRequests.filter((c) => c.status === 'HELD').length : null,
    pendingUsers: isAdmin(me) ? db.users.filter((u) => u.status === 'PENDING').length : null,
  };
}

export function dashboardCounters(ctx: Ctx) {
  return counters(ctx.db, requireMe(ctx));
}

export function dashboard(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const raw = Number(ctx.query.get('days'));
  const days = raw === 30 || raw === 90 ? raw : 7;
  const since = Date.now() - days * 86_400_000;
  const visibleRecords = db.records.filter((r) => r.status === 'ACTIVE' && canSeeGroup(me, r.groupId));
  const visibleCrs = db.changeRequests.filter((c) => crVisible(me, c));
  const executedSince = (c: CrRec) => !!c.executedAt && time(c.executedAt) >= since;
  const groups = listVisibleGroups(ctx);
  const cnt = counters(db, me);
  return {
    days,
    totalRecords: visibleRecords.length,
    addedInPeriod: visibleRecords.filter((r) => time(r.createdAt) >= since).length,
    awaitingApproval: cnt.awaitingApproval,
    myPending: cnt.myPending,
    appliedInPeriod: visibleCrs.filter((c) => c.status === 'APPLIED' && executedSince(c)).length,
    failedInPeriod: visibleCrs.filter((c) => c.status === 'FAILED' && executedSince(c)).length,
    scheduled: cnt.scheduled,
    held: cnt.held,
    pendingUsers: cnt.pendingUsers,
    groupCount: groups.length,
    perGroup: groups.map((g) => ({ id: g.id, name: g.name, count: g.recordCount })).sort((a, b) => b.count - a.count),
    recent: [...visibleCrs].sort((a, b) => b.id - a.id).slice(0, 6).map((c) => crDto(db, c, me)),
    health: [
      { name: 'Portal data store', detail: `This browser's localStorage · ${(storageBytes() / 1024).toFixed(0)} KB used`, status: 'UP' },
      {
        name: 'Bank directory (LDAP)',
        detail: db.settings.ldapEnabled ? `Mock directory in this browser · ${db.directory.length} users` : 'Disabled in demo settings',
        status: db.settings.ldapEnabled ? 'MOCK' : 'DISABLED',
      },
      { name: 'F5 BIG-IP DNS', detail: `Mock mode · not connected · sites ${SITES.join(', ')}`, status: 'MOCK' },
      db.settings.siteRole === 'Active'
        ? { name: 'Change scheduler', detail: `Runs in this browser every ${SCHEDULER_POLL_MS / 1000} s while the portal is open`, status: 'RUNNING' }
        : { name: 'Change scheduler', detail: 'Standby · runs only on the active site', status: 'STANDBY' },
      { name: 'ITSM', detail: 'On hold · waiting for Bank API details', status: 'DISABLED' },
      { name: 'SIEM log forwarder', detail: 'Not in the static demo · the audit trail stays in this browser', status: 'DISABLED' },
    ],
  };
}
