/**
 * Partitions, users, Bank-directory onboarding, access requests, audit trail and demo tools
 * (port of GroupService, UserAdminService, AccessRequestService and AuditController).
 */
import type { AccessLevel } from '../types';
import {
  accessRequestDto,
  audit,
  canSeeGroup,
  isAdmin,
  requireMe,
  userById,
  userByName,
  userDto,
  type Ctx,
} from './context';
import { clearSession, clone, nextId, nowIso, seedDb, storageBytes, type AccessReqRec, type Db, type UserRec } from './db';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { clean, EMAIL_RE, m, normalizeUsername, paginate, PARTITION_RE, temporaryPassword, USERNAME_RE } from './rules';
import { hashPassword } from './sha256';

// ---------------------------------------------------------------- partitions (groups)

export function listVisibleGroups(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  return [...db.groups]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((g) => canSeeGroup(me, g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      recordCount: db.records.filter((r) => r.groupId === g.id && r.status === 'ACTIVE').length,
      writerCount: db.users.filter((u) => u.status !== 'DISABLED' && u.groupIds.includes(g.id)).length,
      createdAt: g.createdAt,
      createdBy: g.createdBy,
    }));
}

function validPartitionName(name: unknown): string {
  const t = typeof name === 'string' ? name.trim() : '';
  if (!PARTITION_RE.test(t)) {
    throw badRequest('Use the F5 partition name: it starts with a letter and has only letters, digits, _ - or . (no spaces), up to 64 characters. Example: Internet_Banking');
  }
  return t;
}

export function createGroup(ctx: Ctx) {
  const db = ctx.db;
  const name = validPartitionName(ctx.body.name);
  const dup = db.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
  if (dup) throw conflict(`A partition named '${dup.name}' already exists.`);
  const g = { id: nextId(db, 'group'), name, description: clean(ctx.body.description, 500), createdAt: nowIso(), createdBy: ctx.me!.username };
  db.groups.push(g);
  audit(ctx, 'GROUP_CREATED', 'SUCCESS', 'GROUP', name, { description: g.description });
  return { ...g, recordCount: 0, writerCount: 0 };
}

export function updateGroup(ctx: Ctx, id: number) {
  const db = ctx.db;
  const g = db.groups.find((x) => x.id === id);
  if (!g) throw notFound('Partition not found.');
  const name = validPartitionName(ctx.body.name);
  const dup = db.groups.find((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
  if (dup) throw conflict(`A partition named '${dup.name}' already exists.`);
  const old = g.name;
  g.name = name;
  g.description = clean(ctx.body.description, 500);
  audit(ctx, 'GROUP_UPDATED', 'SUCCESS', 'GROUP', name, { previousName: old === name ? null : old });
  return listVisibleGroups(ctx).find((x) => x.id === id);
}

export function deleteGroup(ctx: Ctx, id: number) {
  const db = ctx.db;
  const g = db.groups.find((x) => x.id === id);
  if (!g) throw notFound('Partition not found.');
  if (db.records.some((r) => r.groupId === id) || db.changeRequests.some((c) => c.groupId === id)) {
    throw conflict('This partition owns DNS records or change history, so it cannot be deleted.');
  }
  db.groups = db.groups.filter((x) => x.id !== id);
  db.users.forEach((u) => (u.groupIds = u.groupIds.filter((gid) => gid !== id)));
  audit(ctx, 'GROUP_DELETED', 'SUCCESS', 'GROUP', g.name);
  return undefined;
}

// ---------------------------------------------------------------- users

const groupNames = (db: Db, u: UserRec) =>
  u.groupIds
    .map((id) => db.groups.find((g) => g.id === id)?.name)
    .filter(Boolean)
    .sort() as string[];

function latestRequest(db: Db, userId: number): AccessReqRec | undefined {
  return db.accessRequests.filter((r) => r.userId === userId).sort((a, b) => b.id - a.id)[0];
}

export function listUsers(ctx: Ctx) {
  const db = ctx.db;
  return [...db.users]
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((u) => {
      const r = u.status === 'PENDING' ? latestRequest(db, u.id) : undefined;
      return userDto(db, u, r ? accessRequestDto(db, r) : null);
    });
}

function loadUser(db: Db, id: number): UserRec {
  const u = userById(db, id);
  if (!u) throw notFound('User not found.');
  return u;
}

function requireEditable(u: UserRec) {
  if (u.source === 'CONFIG') throw forbidden('The Admin account is managed in the portal configuration, not in the UI.');
}

function validUsername(db: Db, raw: unknown): string {
  const username = normalizeUsername(raw);
  if (!USERNAME_RE.test(username)) throw badRequest('Enter the user ID (for example 140122): 3–64 characters, letters, digits, dot, dash or underscore.');
  if (username === db.settings.adminUsername) throw conflict('This username is reserved for the Admin account.');
  return username;
}

function validEmail(email: unknown): string | null {
  const t = clean(email, 1000);
  if (!t) return null;
  if (!EMAIL_RE.test(t) || t.length > 200) throw badRequest('Enter a valid email address.');
  return t;
}

const cleanDepartment = (d: unknown) => clean(d, 200);

function applyAccess(db: Db, u: UserRec, level: unknown, groupIds: unknown) {
  if (level !== 'READ' && level !== 'WRITE' && level !== 'CHECKER') throw badRequest('Choose an access level: Read only, Read + Write or Checker.');
  let assigned: number[] = [];
  if (level === 'WRITE') {
    const wanted = [...new Set(Array.isArray(groupIds) ? groupIds.map(Number) : [])];
    if (!wanted.length) throw badRequest('Read + Write access needs at least one partition.');
    if (wanted.some((id) => !db.groups.some((g) => g.id === id))) throw badRequest('One or more of the selected partitions no longer exist.');
    assigned = wanted;
  }
  u.groupIds = assigned;
  u.level = level as AccessLevel;
  if (u.status === 'PENDING') u.status = 'ACTIVE';
}

function newUser(username: string, createdBy: string): UserRec {
  return {
    id: 0,
    username,
    displayName: null,
    email: null,
    department: null,
    source: 'LOCAL',
    passwordHash: null,
    level: 'NONE',
    status: 'ACTIVE',
    mustChangePassword: false,
    passwordChangedAt: null,
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: nowIso(),
    createdBy,
    groupIds: [],
  };
}

export function createUser(ctx: Ctx) {
  const db = ctx.db;
  const b = ctx.body;
  const username = validUsername(db, b.username);
  if (userByName(db, username)) throw conflict('A user with this username already exists.');
  const u = newUser(username, ctx.me!.username);
  u.displayName = clean(b.displayName, 200) ?? username;
  u.email = validEmail(b.email);
  u.department = cleanDepartment(b.department);
  applyAccess(db, u, b.level, b.groupIds);
  const temporary = temporaryPassword();
  u.passwordHash = hashPassword(temporary);
  u.mustChangePassword = true;
  u.passwordChangedAt = nowIso();
  u.id = nextId(db, 'user');
  db.users.push(u);
  audit(ctx, 'USER_CREATED', 'SUCCESS', 'USER', username, { source: 'LOCAL', level: u.level, groups: groupNames(db, u) });
  return { user: userDto(db, u), temporaryPassword: temporary };
}

export function updateUser(ctx: Ctx, id: number) {
  const db = ctx.db;
  const b = ctx.body;
  const u = loadUser(db, id);
  requireEditable(u);
  const statusBefore = u.status;
  const levelBefore = u.level;
  const groupsBefore = groupNames(db, u);
  if (u.source === 'LOCAL') {
    const name = clean(b.displayName, 200);
    if (name) u.displayName = name;
    u.email = validEmail(b.email);
  }
  if (b.department !== undefined && b.department !== null) u.department = cleanDepartment(b.department);
  applyAccess(db, u, b.level, b.groupIds);
  const answered = statusBefore === 'PENDING' ? closeOpenRequest(ctx, u, 'GRANTED', null) : null;
  audit(ctx, statusBefore === 'PENDING' ? 'USER_ACCESS_GRANTED' : 'USER_ACCESS_CHANGED', 'SUCCESS', 'USER', u.username, {
    from: { level: levelBefore, groups: groupsBefore },
    to: { level: u.level, groups: groupNames(db, u) },
    requested: answered ? { level: answered.requestedLevel, groups: answered.requestedGroups.map((g) => g.name) } : null,
  });
  return userDto(db, u);
}

export function userAction(ctx: Ctx, id: number, action: string) {
  const db = ctx.db;
  const u = loadUser(db, id);
  requireEditable(u);
  switch (action) {
    case 'disable':
      if (u.status !== 'DISABLED') {
        if (u.status === 'PENDING') closeOpenRequest(ctx, u, 'DECLINED', 'Account disabled by the Admin.');
        u.status = 'DISABLED';
        audit(ctx, 'USER_DISABLED', 'SUCCESS', 'USER', u.username);
      }
      return userDto(db, u);
    case 'enable':
      if (u.status === 'DISABLED') {
        u.status = u.level === 'NONE' ? 'PENDING' : 'ACTIVE';
        u.failedAttempts = 0;
        u.lockedUntil = null;
        audit(ctx, 'USER_ENABLED', 'SUCCESS', 'USER', u.username);
      }
      return userDto(db, u);
    case 'unlock':
      u.failedAttempts = 0;
      u.lockedUntil = null;
      audit(ctx, 'USER_UNLOCKED', 'SUCCESS', 'USER', u.username);
      return userDto(db, u);
    case 'reset-password': {
      if (u.source !== 'LOCAL') throw badRequest('Only local portal accounts have a portal password. LDAP users change their password in the Bank directory.');
      const temporary = temporaryPassword();
      u.passwordHash = hashPassword(temporary);
      u.mustChangePassword = true;
      u.passwordChangedAt = nowIso();
      u.failedAttempts = 0;
      u.lockedUntil = null;
      audit(ctx, 'PASSWORD_RESET', 'SUCCESS', 'USER', u.username);
      return { user: userDto(db, u), temporaryPassword: temporary };
    }
    default:
      throw notFound('Not found.');
  }
}

// ---------------------------------------------------------------- Bank directory: look up an ID, grant before first sign-in

function requireDirectory(db: Db) {
  if (!db.settings.ldapEnabled) throw badRequest('The Bank directory (LDAP) is not enabled in this environment.');
}

export function lookupDirectory(ctx: Ctx, rawId: string) {
  const db = ctx.db;
  const username = validUsername(db, decodeURIComponent(rawId));
  requireDirectory(db);
  const existing = userByName(db, username);
  const entry = db.directory.find((d) => d.uid === username);
  audit(ctx, 'DIRECTORY_LOOKUP', 'SUCCESS', 'USER', username, {
    userId: username,
    name: existing ? existing.displayName : entry?.name,
    found: !!entry,
    hasPortalProfile: !!existing,
  });
  return {
    username,
    found: !!entry,
    displayName: entry?.name ?? null,
    email: entry?.email ?? null,
    department: null,
    existing: existing ? userDto(db, existing) : null,
  };
}

export function grantFromDirectory(ctx: Ctx) {
  const db = ctx.db;
  const b = ctx.body;
  const username = validUsername(db, b.username);
  if (userByName(db, username)) throw conflict(`User ${username} already has a portal profile. Edit their access instead.`);
  requireDirectory(db);
  const entry = db.directory.find((d) => d.uid === username);
  if (!entry) throw notFound(`No user with ID ${username} in the Bank directory.`);
  const u = newUser(username, ctx.me!.username);
  u.source = 'LDAP';
  u.displayName = entry.name || username;
  u.email = entry.email;
  u.department = cleanDepartment(b.department);
  applyAccess(db, u, b.level, b.groupIds);
  u.id = nextId(db, 'user');
  db.users.push(u);
  audit(ctx, 'USER_CREATED', 'SUCCESS', 'USER', username, { source: 'LDAP', via: 'directory lookup', level: u.level, groups: groupNames(db, u) });
  return userDto(db, u);
}

// ---------------------------------------------------------------- access requests

function closeOpenRequest(ctx: Ctx, u: UserRec, outcome: 'GRANTED' | 'DECLINED', comment: string | null) {
  const r = ctx.db.accessRequests.find((x) => x.userId === u.id && x.status === 'OPEN');
  if (!r) return null;
  r.status = outcome;
  r.decidedBy = ctx.me?.username ?? null;
  r.decidedAt = nowIso();
  r.decisionComment = comment;
  return accessRequestDto(ctx.db, r);
}

export function myAccessRequest(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const latest = latestRequest(db, me.id);
  return {
    request: latest ? accessRequestDto(db, latest) : null,
    partitions: [...db.groups].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ id: g.id, name: g.name, description: g.description })),
  };
}

export function submitAccessRequest(ctx: Ctx) {
  const me = requireMe(ctx);
  const db = ctx.db;
  const b = ctx.body;
  const user = userById(db, me.id)!;
  if (user.status !== 'PENDING') throw conflict('You already have access. Ask the Admin if you need a change.');
  const department = clean(b.department, 200);
  if (!department || department.length < 2) throw badRequest('Enter your department.');
  const level = b.level;
  if (level !== 'READ' && level !== 'WRITE' && level !== 'CHECKER') throw badRequest('Choose the access you need: Read only, Read + Write or Checker.');
  let ids: number[] = [];
  if (level === 'WRITE') {
    const wanted = [...new Set(Array.isArray(b.groupIds) ? b.groupIds.map(Number) : [])];
    if (!wanted.length) throw badRequest('Choose at least one partition for Read + Write access.');
    if (wanted.some((id) => !db.groups.some((g) => g.id === id))) throw badRequest('One or more of the chosen partitions no longer exist.');
    ids = wanted.sort((x, y) => x - y);
  }
  const reason = clean(b.reason, 1000);
  if (!reason) throw badRequest('Say why you need this access.');

  let r = db.accessRequests.find((x) => x.userId === user.id && x.status === 'OPEN');
  const updating = !!r;
  const now = nowIso();
  if (!r) {
    r = { id: nextId(db, 'accessRequest'), userId: user.id, department, requestedLevel: level, requestedGroupIds: ids, reason, status: 'OPEN', createdAt: now, updatedAt: now, decidedBy: null, decidedAt: null, decisionComment: null };
    db.accessRequests.push(r);
  } else {
    Object.assign(r, { department, requestedLevel: level, requestedGroupIds: ids, reason, updatedAt: now });
  }
  user.department = department;
  audit(ctx, updating ? 'ACCESS_REQUEST_UPDATED' : 'ACCESS_REQUEST_RAISED', 'SUCCESS', 'USER', user.username, {
    department,
    requestedLevel: level,
    requestedPartitions: ids.map((id) => db.groups.find((g) => g.id === id)?.name).sort(),
    reason,
  });
  return accessRequestDto(db, r);
}

export function declineAccessRequest(ctx: Ctx, userId: number) {
  const db = ctx.db;
  const text = clean(ctx.body.comment, 1000);
  if (!text) throw badRequest('Give the user a reason for declining.');
  const r = db.accessRequests.find((x) => x.userId === userId && x.status === 'OPEN');
  if (!r) throw conflict('This user has no open access request.');
  r.status = 'DECLINED';
  r.decidedBy = ctx.me!.username;
  r.decidedAt = nowIso();
  r.decisionComment = text;
  audit(ctx, 'ACCESS_REQUEST_DECLINED', 'SUCCESS', 'USER', userById(db, userId)?.username, { comment: text, requestedLevel: r.requestedLevel });
  return accessRequestDto(db, r);
}

// ---------------------------------------------------------------- audit trail

export function listAudit(ctx: Ctx) {
  const q = ctx.query;
  const outcome = q.get('outcome');
  const term = (q.get('q') ?? '').trim().toLowerCase();
  const items = ctx.db.audit
    .filter(
      (e) =>
        (!outcome || e.outcome === outcome) &&
        (!term ||
          (e.actor ?? '').toLowerCase().includes(term) ||
          e.action.toLowerCase().includes(term) ||
          (e.targetId ?? '').toLowerCase().includes(term) ||
          JSON.stringify(e.details ?? {}).toLowerCase().includes(term)),
    )
    .sort((a, b) => b.id - a.id);
  return paginate(items, q.get('page'), q.get('size'), 50);
}

// ---------------------------------------------------------------- demo tools (static portal only)

export function demoInfo(ctx: Ctx) {
  const db = ctx.db;
  return {
    settings: { siteRole: db.settings.siteRole, ldapEnabled: db.settings.ldapEnabled, f5FailSuffix: db.settings.f5FailSuffix },
    directory: [...db.directory]
      .sort((a, b) => a.uid.localeCompare(b.uid))
      .map((d) => {
        const u = userByName(db, d.uid);
        return { uid: d.uid, name: d.name, email: d.email, portalStatus: u ? u.status : null, portalLevel: u ? u.level : null };
      }),
    storageBytes: storageBytes(),
    counts: { users: db.users.length, partitions: db.groups.length, records: db.records.length, changeRequests: db.changeRequests.length, auditEvents: db.audit.length },
  };
}

export function addDirectoryUser(ctx: Ctx) {
  const db = ctx.db;
  const b = ctx.body;
  const uid = normalizeUsername(b.uid);
  if (!/^[a-z0-9._-]{3,64}$/.test(uid)) throw badRequest('User ID must be 3–64 characters: letters, digits, dot, dash or underscore (for example 140127).');
  if (uid === db.settings.adminUsername) throw conflict('This ID is reserved for the Admin account.');
  if (db.directory.some((d) => d.uid === uid)) throw conflict(`${uid} is already in the mock Bank directory.`);
  const name = clean(b.name, 200);
  if (!name) throw badRequest('Enter the person’s name.');
  if (typeof b.password !== 'string' || !b.password) throw badRequest('Enter a password for the directory account.');
  const email = clean(b.email, 200) ?? `${name.toLowerCase().split(/\s+/).join('.')}@bank.local`;
  db.directory.push({ uid, name, email, passwordHash: hashPassword(b.password) });
  audit(ctx, 'DEMO_DIRECTORY_USER_ADDED', 'SUCCESS', 'DIRECTORY', uid, { name, email });
  return demoInfo(ctx);
}

export function removeDirectoryUser(ctx: Ctx, uid: string) {
  const db = ctx.db;
  const id = decodeURIComponent(uid);
  const entry = db.directory.find((d) => d.uid === id);
  if (!entry) throw notFound(`${id} is not in the mock Bank directory.`);
  db.directory = db.directory.filter((d) => d.uid !== id);
  audit(ctx, 'DEMO_DIRECTORY_USER_REMOVED', 'SUCCESS', 'DIRECTORY', id, { name: entry.name });
  return demoInfo(ctx);
}

export function updateDemoSettings(ctx: Ctx) {
  const db = ctx.db;
  const b = ctx.body;
  const before = { ...db.settings };
  if (b.siteRole === 'Active' || b.siteRole === 'Standby') db.settings.siteRole = b.siteRole;
  if (typeof b.ldapEnabled === 'boolean') db.settings.ldapEnabled = b.ldapEnabled;
  if (typeof b.f5FailSuffix === 'string') db.settings.f5FailSuffix = b.f5FailSuffix.trim().slice(0, 60);
  audit(ctx, 'DEMO_SETTINGS_CHANGED', 'SUCCESS', 'SYSTEM', null, m({
    siteRole: before.siteRole !== db.settings.siteRole ? db.settings.siteRole : null,
    ldapEnabled: before.ldapEnabled !== db.settings.ldapEnabled ? db.settings.ldapEnabled : null,
    f5FailSuffix: before.f5FailSuffix !== db.settings.f5FailSuffix ? db.settings.f5FailSuffix : null,
  }));
  return demoInfo(ctx);
}

export function exportData(ctx: Ctx) {
  return clone(ctx.db);
}

/** Replaces all data with an exported file. Everyone is signed out. */
export function importData(ctx: Ctx): Db {
  const data = ctx.body.data as Db | undefined;
  if (!data || data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.groups) || !Array.isArray(data.records) || !data.settings) {
    throw badRequest('This file is not a DNS portal static-demo export.');
  }
  if (!data.users.some((u) => u.source === 'CONFIG' && u.level === 'ADMIN')) throw badRequest('The file has no Admin account.');
  return data;
}

export function resetData(): Db {
  clearSession();
  return seedDb();
}

export const adminOnly = (ctx: Ctx) => {
  if (!ctx.me || !isAdmin(ctx.me)) throw forbidden('You do not have permission for this action.');
};
