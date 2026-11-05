/**
 * Sign-in flow (same as the real portal):
 *   1. Look the user ID up in the portal data (configuration Admin, local users, known directory users).
 *   2. Admin / local user -> check the stored password hash. Directory user -> check against the mock Bank directory.
 *   3. Unknown ID -> ask the Bank directory; a first successful sign-in creates a PENDING profile.
 *   Lockout after 5 failures for 15 minutes; local passwords expire after 90 days.
 */
import { clearSession, nextId, nowIso, readSession, SESSION_IDLE_MS, writeSession, type Db, type UserRec } from './db';
import { audit, meDto, principalOf, requireMe, userById, userByName, writeAudit, isLocked, type Ctx, type Principal } from './context';
import { ApiError, badRequest, forbidden } from './errors';
import { checkPassword, normalizeUsername, PASSWORD_MIN_LENGTH } from './rules';
import { hashPassword, verifyPassword } from './sha256';

const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_MAX_AGE_DAYS = 90;

export function publicConfig(ctx: Ctx) {
  return {
    portalName: 'DNS Management Portal',
    orgName: 'F5 BIG-IP DNS',
    siteName: ctx.db.settings.siteName,
    siteRole: ctx.db.settings.siteRole,
    version: '0.1.0-static',
    ldapEnabled: ctx.db.settings.ldapEnabled,
    passwordMinLength: PASSWORD_MIN_LENGTH,
    departments: ctx.db.settings.departments,
  };
}

/** The session holds only the user ID; the user is re-read on every request, like SessionUserFilter. */
export function resolvePrincipal(db: Db): Principal | null {
  const s = readSession();
  if (!s) return null;
  if (Date.now() - s.lastActive > SESSION_IDLE_MS) {
    clearSession();
    return null;
  }
  const u = userById(db, s.userId);
  if (!u || u.status === 'DISABLED') {
    clearSession();
    return null;
  }
  writeSession(u.id); // sliding idle timeout
  return principalOf(u);
}

const invalidCredentials = () => new ApiError(401, 'Invalid username or password.');

function directoryAuthenticate(db: Db, username: string, password: string) {
  if (!db.settings.ldapEnabled) return null;
  const d = db.directory.find((x) => x.uid === username);
  return d && verifyPassword(password, d.passwordHash) ? d : null;
}

export function login(ctx: Ctx) {
  ctx.commitOnError = true; // failed attempts and their audit events are kept
  const db = ctx.db;
  const username = normalizeUsername(ctx.body.username);
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!username || !password) throw badRequest('Enter your username and password.');

  const existing = userByName(db, username);
  const user = existing ? loginKnownUser(db, existing, password) : loginNewDirectoryUser(db, username, password);
  writeSession(user.id);
  return meDto(db, user);
}

function loginKnownUser(db: Db, user: UserRec, password: string): UserRec {
  if (isLocked(user)) {
    writeAudit(db, user.username, 'LOGIN', 'DENIED', 'USER', user.username, { reason: 'account locked' });
    throw forbidden('This account is locked after too many failed attempts. Try again later or ask the Admin to unlock it.');
  }
  let identity: { name: string; email: string | null } | null = null;
  let valid = false;
  if (user.source === 'CONFIG') valid = user.status !== 'DISABLED' && verifyPassword(password, db.settings.adminPasswordHash);
  else if (user.source === 'LOCAL') valid = verifyPassword(password, user.passwordHash);
  else if (user.source === 'LDAP') {
    identity = directoryAuthenticate(db, user.username, password);
    valid = identity !== null;
  }
  if (!valid) {
    registerFailure(db, user);
    throw invalidCredentials();
  }
  if (user.status === 'DISABLED') {
    writeAudit(db, user.username, 'LOGIN', 'DENIED', 'USER', user.username, { reason: 'account disabled' });
    throw forbidden('This account is disabled. Contact the portal Admin.');
  }
  user.failedAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = nowIso();
  if (identity) {
    if (identity.name) user.displayName = identity.name;
    if (identity.email) user.email = identity.email;
  }
  if (user.source === 'LOCAL' && user.passwordChangedAt) {
    const age = Date.now() - new Date(user.passwordChangedAt).getTime();
    if (age > PASSWORD_MAX_AGE_DAYS * 86_400_000) user.mustChangePassword = true;
  }
  writeAudit(db, user.username, 'LOGIN', 'SUCCESS', 'USER', user.username, { source: user.source, status: user.status });
  return user;
}

function loginNewDirectoryUser(db: Db, username: string, password: string): UserRec {
  if (!db.settings.ldapEnabled) {
    writeAudit(db, username, 'LOGIN', 'FAILURE', 'USER', username, { reason: 'unknown user' });
    throw invalidCredentials();
  }
  const identity = directoryAuthenticate(db, username, password);
  if (!identity) {
    writeAudit(db, username, 'LOGIN', 'FAILURE', 'USER', username, { reason: 'invalid directory credentials' });
    throw invalidCredentials();
  }
  const user: UserRec = {
    id: nextId(db, 'user'),
    username,
    displayName: identity.name || username,
    email: identity.email,
    department: null,
    source: 'LDAP',
    passwordHash: null,
    level: 'NONE',
    status: 'PENDING',
    mustChangePassword: false,
    passwordChangedAt: null,
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: nowIso(),
    createdAt: nowIso(),
    createdBy: 'ldap-first-login',
    groupIds: [],
  };
  db.users.push(user);
  writeAudit(db, username, 'USER_PENDING_CREATED', 'SUCCESS', 'USER', username, { source: 'LDAP', displayName: user.displayName });
  writeAudit(db, username, 'LOGIN', 'SUCCESS', 'USER', username, { source: 'LDAP', status: 'PENDING' });
  return user;
}

function registerFailure(db: Db, user: UserRec) {
  const attempts = user.failedAttempts + 1;
  writeAudit(db, user.username, 'LOGIN', 'FAILURE', 'USER', user.username, { reason: 'invalid credentials', failedAttempts: attempts });
  if (attempts >= MAX_FAILED) {
    user.failedAttempts = 0;
    user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    writeAudit(db, user.username, 'ACCOUNT_LOCKED', 'SUCCESS', 'USER', user.username, { minutes: LOCKOUT_MINUTES });
  } else {
    user.failedAttempts = attempts;
  }
}

export function me(ctx: Ctx) {
  const p = requireMe(ctx);
  return meDto(ctx.db, userById(ctx.db, p.id)!);
}

export function logout(ctx: Ctx) {
  if (ctx.me) audit(ctx, 'LOGOUT', 'SUCCESS', 'USER', ctx.me.username);
  clearSession();
  return undefined;
}

export function changePassword(ctx: Ctx) {
  ctx.commitOnError = true;
  const p = requireMe(ctx);
  const user = userById(ctx.db, p.id)!;
  if (user.source !== 'LOCAL') {
    throw badRequest(
      user.source === 'LDAP'
        ? 'Your password is managed by the Bank directory. Change it there.'
        : 'The Admin password is managed in the portal configuration.',
    );
  }
  const current = typeof ctx.body.currentPassword === 'string' ? ctx.body.currentPassword : '';
  if (!verifyPassword(current, user.passwordHash)) {
    audit(ctx, 'PASSWORD_CHANGE', 'FAILURE', 'USER', user.username, { reason: 'current password incorrect' });
    throw badRequest('The current password is not correct.');
  }
  const next = checkPassword(ctx.body.newPassword, user.username);
  if (verifyPassword(next, user.passwordHash)) throw badRequest('The new password must be different from the current one.');
  user.passwordHash = hashPassword(next);
  user.mustChangePassword = false;
  user.passwordChangedAt = nowIso();
  audit(ctx, 'PASSWORD_CHANGED', 'SUCCESS', 'USER', user.username);
  return meDto(ctx.db, user);
}
