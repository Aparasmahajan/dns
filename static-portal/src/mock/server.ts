/**
 * The static portal's "backend": the same REST API as the real portal, answered inside the browser.
 *
 * Every call:
 *   1. runs due scheduled changes (Active site only), like the server's scheduler;
 *   2. resolves the signed-in user from the session and checks the URL against the same access rules as the
 *      real SecurityConfig (public / signed-in / Admin / waiting-for-access / portal roles);
 *   3. runs the handler on a copy of the data and saves it only if the call succeeds (all or nothing, like a
 *      database transaction). Failed sign-ins and denied-access audit events are kept, as in the real portal.
 */
import * as admin from './admin';
import * as auth from './auth';
import * as changes from './changes';
import { roleOf, type Ctx } from './context';
import { clearSession, clone, loadDb, saveDb, type Db } from './db';
import { ApiError, forbidden, notFound, unauthorized } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Handler = (ctx: Ctx, params: string[]) => unknown;

const n = (s: string) => Number(s);

const routes: [Method, RegExp, Handler][] = [
  ['GET', /^\/api\/public\/config$/, (c) => auth.publicConfig(c)],

  ['POST', /^\/api\/auth\/login$/, (c) => auth.login(c)],
  ['GET', /^\/api\/auth\/me$/, (c) => auth.me(c)],
  ['POST', /^\/api\/auth\/logout$/, (c) => auth.logout(c)],
  ['POST', /^\/api\/auth\/change-password$/, (c) => auth.changePassword(c)],

  ['GET', /^\/api\/dashboard$/, (c) => changes.dashboard(c)],
  ['GET', /^\/api\/dashboard\/counters$/, (c) => changes.dashboardCounters(c)],

  ['GET', /^\/api\/records$/, (c) => changes.listRecords(c)],
  ['GET', /^\/api\/records\/(\d+)$/, (c, [id]) => changes.getRecord(c, n(id))],

  ['GET', /^\/api\/change-requests$/, (c) => changes.listRequests(c)],
  ['POST', /^\/api\/change-requests$/, (c) => changes.submit(c)],
  ['GET', /^\/api\/change-requests\/(\d+)$/, (c, [id]) => changes.getRequest(c, n(id))],
  ['PUT', /^\/api\/change-requests\/(\d+)$/, (c, [id]) => changes.update(c, n(id))],
  ['POST', /^\/api\/change-requests\/(\d+)\/approve$/, (c, [id]) => changes.approve(c, n(id))],
  ['POST', /^\/api\/change-requests\/(\d+)\/reject$/, (c, [id]) => changes.reject(c, n(id))],
  ['POST', /^\/api\/change-requests\/(\d+)\/cancel$/, (c, [id]) => changes.cancel(c, n(id))],
  ['POST', /^\/api\/change-requests\/(\d+)\/confirm$/, (c, [id]) => changes.confirmHeld(c, n(id))],

  ['GET', /^\/api\/groups$/, (c) => admin.listVisibleGroups(c)],
  ['POST', /^\/api\/admin\/groups$/, (c) => admin.createGroup(c)],
  ['PUT', /^\/api\/admin\/groups\/(\d+)$/, (c, [id]) => admin.updateGroup(c, n(id))],
  ['DELETE', /^\/api\/admin\/groups\/(\d+)$/, (c, [id]) => admin.deleteGroup(c, n(id))],

  ['GET', /^\/api\/admin\/records\/(\d+)\/rollback-preview$/, (c, [id]) => changes.rollbackPreview(c, n(id))],
  ['POST', /^\/api\/admin\/records\/(\d+)\/rollback$/, (c, [id]) => changes.rollback(c, n(id))],

  ['GET', /^\/api\/admin\/users$/, (c) => admin.listUsers(c)],
  ['POST', /^\/api\/admin\/users$/, (c) => admin.createUser(c)],
  ['GET', /^\/api\/admin\/users\/directory\/([^/]+)$/, (c, [id]) => admin.lookupDirectory(c, id)],
  ['POST', /^\/api\/admin\/users\/from-directory$/, (c) => admin.grantFromDirectory(c)],
  ['PUT', /^\/api\/admin\/users\/(\d+)$/, (c, [id]) => admin.updateUser(c, n(id))],
  ['POST', /^\/api\/admin\/users\/(\d+)\/decline-request$/, (c, [id]) => admin.declineAccessRequest(c, n(id))],
  ['POST', /^\/api\/admin\/users\/(\d+)\/(disable|enable|unlock|reset-password)$/, (c, [id, action]) => admin.userAction(c, n(id), action)],

  ['GET', /^\/api\/access-requests\/mine$/, (c) => admin.myAccessRequest(c)],
  ['POST', /^\/api\/access-requests$/, (c) => admin.submitAccessRequest(c)],

  ['GET', /^\/api\/admin\/audit$/, (c) => admin.listAudit(c)],

  // Static demo tools
  ['GET', /^\/api\/admin\/demo$/, (c) => admin.demoInfo(c)],
  ['POST', /^\/api\/admin\/demo\/directory$/, (c) => admin.addDirectoryUser(c)],
  ['DELETE', /^\/api\/admin\/demo\/directory\/([^/]+)$/, (c, [uid]) => admin.removeDirectoryUser(c, uid)],
  ['PUT', /^\/api\/admin\/demo\/settings$/, (c) => admin.updateDemoSettings(c)],
  ['GET', /^\/api\/admin\/demo\/export$/, (c) => admin.exportData(c)],
];

/** Same URL rules as the real portal's SecurityConfig. */
function checkAccess(method: Method, path: string, ctx: Ctx) {
  if (path.startsWith('/api/public/')) return;
  if (method === 'POST' && path === '/api/auth/login') return;
  if (!ctx.me) throw unauthorized();
  if (path.startsWith('/api/auth/')) return;
  const role = roleOf(ctx.me);
  const denied = () => forbidden('You do not have permission for this action.');
  if (path.startsWith('/api/admin/')) {
    if (role !== 'ADMIN') throw denied();
    return;
  }
  if (path.startsWith('/api/access-requests')) {
    if (role !== 'PENDING') throw denied();
    return;
  }
  if (!['READ', 'WRITE', 'CHECKER', 'ADMIN'].includes(role)) throw denied();
}

/** Runs due scheduled jobs and saves; returns how many ran. Also called every 15 s while the portal is open. */
export function schedulerTick(): number {
  const db = loadDb();
  const ran = changes.runDueJobs(db);
  if (ran > 0) saveDb(db);
  return ran;
}

function replaceAll(db: Db) {
  saveDb(db);
}

export async function handleRequest(method: Method, url: string, body: unknown): Promise<unknown> {
  // Let the UI paint before work starts, like a network round trip.
  await Promise.resolve();
  schedulerTick();

  const parsed = new URL(url, 'http://static.portal');
  const path = parsed.pathname;

  // Data replacement endpoints (reset is public so a locked-out demo can always start again).
  if (method === 'POST' && path === '/api/public/demo/reset') {
    replaceAll(admin.resetData());
    return undefined;
  }

  const committed = loadDb();
  const draft = clone(committed);
  const ctx: Ctx = {
    db: draft,
    me: null,
    query: parsed.searchParams,
    body: body && typeof body === 'object' ? (clone(body) as Record<string, unknown>) : {},
    commitOnError: false,
    deferred: [],
  };
  ctx.me = auth.resolvePrincipal(draft);

  try {
    checkAccess(method, path, ctx);
    if (method === 'POST' && path === '/api/admin/demo/import') {
      replaceAll(admin.importData(ctx));
      clearSession(); // the imported data has its own users: everyone signs in again
      return undefined;
    }
    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = re.exec(path);
      if (match) {
        const result = handler(ctx, match.slice(1));
        saveDb(ctx.db);
        return result === undefined ? undefined : clone(result);
      }
    }
    throw notFound('Not found.');
  } catch (e) {
    if (e instanceof ApiError) {
      if (ctx.commitOnError) saveDb(ctx.db);
      else if (ctx.deferred.length) {
        const fresh = clone(committed);
        ctx.deferred.forEach((write) => write(fresh));
        saveDb(fresh);
      }
      throw e;
    }
    console.error('Static portal: unexpected error in', method, url, e);
    throw new ApiError(500, 'Unexpected error. It has been logged in the browser console.');
  }
}
