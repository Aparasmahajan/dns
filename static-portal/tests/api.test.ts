/**
 * End-to-end tests of the static portal's in-browser backend (same scenarios as the real portal's API tests).
 * Run: npm test   (bundles this file with esbuild and runs it in Node with an in-memory localStorage)
 */
import { ApiError } from '../src/mock/errors';
import { handleRequest, schedulerTick } from '../src/mock/server';

// ---------------------------------------------------------------- harness

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
const SESSION = 'dnsportal.static.session';
const DATA = 'dnsportal.static.v1';
const sessions = new Map<string, string | undefined>();

let pass = 0;
let fail = 0;
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

type Res = { status: number; body: any };
async function call(who: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<Res> {
  if (who) {
    const s = sessions.get(who);
    if (s) store.set(SESSION, s);
    else store.delete(SESSION);
  } else store.delete(SESSION);
  try {
    const result = await handleRequest(method, url, body);
    return { status: 200, body: result };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: { message: e.message } };
    throw e;
  } finally {
    if (who) sessions.set(who, store.get(SESSION));
  }
}
async function login(who: string, username: string, password: string): Promise<Res> {
  sessions.delete(who);
  return call(who, 'POST', '/api/auth/login', { username, password });
}
function data(): any {
  return JSON.parse(store.get(DATA)!);
}
function mutate(fn: (db: any) => void) {
  const db = data();
  fn(db);
  store.set(DATA, JSON.stringify(db));
}
const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const spec = (mappingType: string, domain: string, ips: string[], ttl = 300) => ({ mappingType, domain, ips, ttl });

// ---------------------------------------------------------------- scenarios

async function main() {
  console.log('== Sample data and sign-in');
  let r = await call(null, 'GET', '/api/public/config');
  check('public config', r.status === 200 && r.body.siteName === 'DC-1' && r.body.ldapEnabled === true);
  r = await call(null, 'GET', '/api/auth/me');
  check('anonymous /me -> 401', r.status === 401);
  r = await login('admin', 'admin', 'wrong');
  check('admin wrong password -> 401', r.status === 401);
  r = await login('admin', 'admin', 'Admin@Portal2026');
  check('admin sign-in', r.status === 200 && r.body.level === 'ADMIN' && r.body.source === 'CONFIG');
  r = await call('admin', 'GET', '/api/admin/users');
  check('only admin, 140122, 140123', JSON.stringify(r.body.map((u: any) => u.username).sort()) === '["140122","140123","admin"]');
  r = await call('admin', 'GET', '/api/groups');
  const g = Object.fromEntries(r.body.map((x: any) => [x.name, x]));
  check('3 partitions with record counts', g.Core_Banking?.recordCount === 2 && g.Internet_Banking?.recordCount === 2 && g.UPI_Payments?.recordCount === 1);
  r = await login('pravez', '140122', '12345677');
  check('Pravez signs in (Read+Write)', r.status === 200 && r.body.level === 'WRITE' && !r.body.mustChangePassword);
  r = await call('pravez', 'GET', '/api/records');
  check('Pravez sees only his partitions', r.body.totalElements === 3 && r.body.content.every((x: any) => x.group.name !== 'Core_Banking'));
  const cbs = data().records.find((x: any) => x.recordKey === 'cbs.bank.example');
  r = await call('pravez', 'GET', `/api/records/${cbs.id}`);
  check("Pravez reading another partition's record -> 403", r.status === 403);
  r = await call('pravez', 'GET', '/api/admin/users');
  check('Pravez on an Admin URL -> 403', r.status === 403);

  console.log('== Directory onboarding (Admin grants first) and first sign-in');
  r = await call('admin', 'GET', '/api/admin/users/directory/140124');
  check('lookup 140124 -> Anoop Tiwari, not in portal', r.body.found && r.body.displayName === 'Anoop Tiwari' && r.body.existing === null && r.body.department === null);
  r = await call('admin', 'POST', '/api/admin/users/from-directory', { username: '140124', level: 'CHECKER' });
  check('grant Anoop Checker from directory', r.status === 200 && r.body.source === 'LDAP' && r.body.level === 'CHECKER');
  r = await login('anoop', '140124', '12345677');
  check('Anoop signs in as Checker', r.status === 200 && r.body.level === 'CHECKER');
  r = await login('paras', '140126', '12345677');
  check('Paras first sign-in -> pending', r.status === 200 && r.body.status === 'PENDING');
  r = await call('paras', 'GET', '/api/records');
  check('pending user cannot see records', r.status === 403);
  r = await call('paras', 'GET', '/api/access-requests/mine');
  check('request form offers partitions', r.body.request === null && r.body.partitions.length === 3);
  r = await call('paras', 'POST', '/api/access-requests', { department: '', level: 'READ', reason: 'x' });
  check('department required', r.status === 400);
  r = await call(null, 'GET', '/api/public/config');
  check('department list offered', r.body.departments.includes('IT Infrastructure'));
  r = await call('paras', 'POST', '/api/access-requests', { department: 'Somewhere Else', level: 'READ', reason: 'x' });
  check('department must come from the list', r.status === 400 && r.body.message.includes('from the list'));
  r = await call('paras', 'POST', '/api/access-requests', { department: 'IT Infrastructure', level: 'WRITE', groupIds: [g.Internet_Banking.id], reason: 'Internet banking DNS' });
  check('access request raised', r.status === 200 && r.body.status === 'OPEN');
  const parasId = data().users.find((u: any) => u.username === '140126').id;
  r = await call('admin', 'POST', `/api/admin/users/${parasId}/decline-request`, { comment: 'Confirm with your manager' });
  check('Admin declines with reason', r.body.status === 'DECLINED');
  r = await call('paras', 'GET', '/api/access-requests/mine');
  check('Paras sees the reason', r.body.request.status === 'DECLINED' && r.body.request.decisionComment.includes('manager'));
  await call('paras', 'POST', '/api/access-requests', { department: 'IT Infrastructure', level: 'WRITE', groupIds: [g.Internet_Banking.id, g.UPI_Payments.id], reason: 'Confirmed' });
  r = await call('admin', 'PUT', `/api/admin/users/${parasId}`, { department: 'IT Infrastructure', level: 'WRITE', groupIds: [g.Internet_Banking.id] });
  check('Admin grants (adjusted)', r.status === 200 && r.body.status === 'ACTIVE' && r.body.groups.length === 1);
  r = await call('paras', 'GET', '/api/auth/me');
  check('Paras has access on next call, department kept', r.body.level === 'WRITE' && r.body.department === 'IT Infrastructure');

  console.log('== Local user: temporary password, forced change, Read only');
  r = await call('admin', 'POST', '/api/admin/users', { username: '140150', displayName: 'Ravi', level: 'READ' });
  check('create local Read user', r.status === 200 && r.body.temporaryPassword.length >= 12);
  const temp = r.body.temporaryPassword;
  r = await login('ravi', '140150', temp);
  check('first sign-in must change password', r.body.mustChangePassword === true);
  r = await call('ravi', 'GET', '/api/records');
  check('records blocked until changed', r.status === 403);
  r = await call('ravi', 'POST', '/api/auth/change-password', { currentPassword: temp, newPassword: 'short' });
  check('weak password refused', r.status === 400);
  r = await call('ravi', 'POST', '/api/auth/change-password', { currentPassword: temp, newPassword: 'Ravi@Secure2026' });
  check('password changed', r.status === 200 && r.body.mustChangePassword === false);
  r = await call('ravi', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Internet_Banking.id, spec: spec('SINGLE', 'x.bank.example', ['10.1.1.1']), reason: 'x' });
  check('Read user cannot submit', r.status === 403);

  console.log('== Maker-checker');
  r = await call('pravez', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Internet_Banking.id, spec: spec('SINGLE', 'yono.bank.example', ['10.10.2.10']), reason: 'New app' });
  check('Write user create -> pending', r.body.status === 'PENDING_APPROVAL' && r.body.direct === false);
  const cr1 = r.body.id;
  r = await call('pravez', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Core_Banking.id, spec: spec('SINGLE', 'x.bank.example', ['10.1.1.1']), reason: 'x' });
  check('other partition -> 403', r.status === 403);
  r = await call('pravez', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Internet_Banking.id, spec: spec('SINGLE', 'yono.bank.example', ['10.10.2.11']), reason: 'again' });
  check('second open request for same name -> 409', r.status === 409);
  r = await call('pravez', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Internet_Banking.id, spec: spec('SINGLE', 'bad_name', ['999.1.1.1'], 5), reason: 'x' });
  check('invalid domain / IP / TTL -> 400', r.status === 400 && r.body.message.includes('IPv4') && r.body.message.includes('TTL'));
  r = await call('pravez', 'POST', `/api/change-requests/${cr1}/approve`, {});
  check('maker cannot approve', r.status === 403);
  r = await call('anoop', 'POST', `/api/change-requests/${cr1}/reject`, {});
  check('reject needs a comment', r.status === 400);
  r = await call('anoop', 'POST', `/api/change-requests/${cr1}/approve`, { comment: 'ok' });
  check('Checker approves -> applied v1.0 at 3 sites', r.body.status === 'APPLIED' && r.body.resultVersion === '1.0' && r.body.executionResult.length === 3);
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Core_Banking.id, spec: spec('MULTI', 'ledger.bank.example', ['10.70.0.2', '10.70.0.1']), reason: 'ledger' });
  check('Checker direct change, IPs sorted', r.body.status === 'APPLIED' && r.body.direct && JSON.stringify(r.body.proposed.ips) === '["10.70.0.1","10.70.0.2"]');
  const ledger = r.body.recordId;
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Core_Banking.id, spec: spec('PTR', 'ledger.bank.example', ['10.70.0.1']), reason: 'reverse' });
  check('PTR gets in-addr.arpa name', r.body.proposed.ptrName === '1.0.70.10.in-addr.arpa');
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Core_Banking.id, spec: spec('SINGLE', 'broken.fail.test', ['10.9.9.9']), reason: 'fail' });
  check('mock F5 failure at DR', r.body.status === 'FAILED' && r.body.executionResult.find((s: any) => s.site === 'DR').success === false);

  console.log('== Scheduling');
  r = await call('pravez', 'POST', '/api/change-requests', { operation: 'CREATE', groupId: g.Internet_Banking.id, spec: spec('SINGLE', 's.bank.example', ['10.1.2.3']), reason: 'x', scheduledAt: inMinutes(60) });
  check('a new record cannot be scheduled', r.status === 400 && r.body.message.includes('Only updates'));
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'DELETE', recordId: ledger, reason: 'x', scheduledAt: inMinutes(60) });
  check('a delete cannot be scheduled', r.status === 400 && r.body.message.includes('Only updates'));
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'MODIFY', recordId: ledger, spec: spec('MULTI', 'ledger.bank.example', ['10.70.0.1', '10.70.0.3']), reason: 'night', scheduledAt: inMinutes(-5) });
  check('time in the past refused', r.status === 400);
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'MODIFY', recordId: ledger, spec: spec('MULTI', 'ledger.bank.example', ['10.70.0.1', '10.70.0.3']), reason: 'night', scheduledAt: inMinutes(60) });
  check('Checker scheduled modify -> SCHEDULED', r.body.status === 'SCHEDULED');
  const s1 = r.body.id;
  mutate((db) => (db.changeRequests.find((c: any) => c.id === s1).scheduledAt = inMinutes(-1)));
  mutate((db) => (db.settings.siteRole = 'Standby'));
  check('Standby site does not run due jobs', schedulerTick() === 0);
  mutate((db) => (db.settings.siteRole = 'Active'));
  check('Active site runs it', schedulerTick() === 1);
  r = await call('anoop', 'GET', `/api/change-requests/${s1}`);
  check('scheduled change applied as v1.1', r.body.status === 'APPLIED' && r.body.resultVersion === '1.1');
  check('audited as scheduler', data().audit.some((e: any) => e.actor === 'scheduler' && e.action === 'DIRECT_CHANGE_APPLIED'));
  r = await call('anoop', 'POST', '/api/change-requests', { operation: 'MODIFY', recordId: ledger, spec: spec('SINGLE', 'ledger.bank.example', ['10.70.0.9']), reason: 'later', scheduledAt: inMinutes(60) });
  const s2 = r.body.id;
  await call('anoop', 'POST', '/api/change-requests', { operation: 'MODIFY', recordId: ledger, spec: spec('SINGLE', 'ledger.bank.example', ['10.70.0.5']), reason: 'urgent' });
  mutate((db) => (db.changeRequests.find((c: any) => c.id === s2).scheduledAt = inMinutes(-1)));
  schedulerTick();
  r = await call('anoop', 'GET', `/api/change-requests/${s2}`);
  check('stale scheduled change fails safely', r.body.status === 'FAILED' && r.body.errorMessage.includes('changed after'));

  console.log('== Rollback (Admin)');
  r = await call('anoop', 'GET', `/api/admin/records/${ledger}/rollback-preview?toVersion=1.0`);
  check('Checker cannot roll back', r.status === 403);
  r = await call('admin', 'GET', `/api/admin/records/${ledger}/rollback-preview?toVersion=1.0`);
  check('preview v1.2 -> v1.3', r.body.currentVersion === '1.2' && r.body.resultVersion === '1.3' && r.body.blocker === null && r.body.live.status === 'NOT_CHECKED');
  r = await call('admin', 'POST', `/api/admin/records/${ledger}/rollback`, { toVersion: '1.0', reason: 'revert' });
  check('rollback applied as v1.3 with v1.0 config', r.body.status === 'APPLIED' && r.body.resultVersion === '1.3' && JSON.stringify(r.body.proposed.ips) === '["10.70.0.1","10.70.0.2"]');
  r = await call('admin', 'POST', `/api/admin/records/${ledger}/rollback`, { toVersion: '1.0', reason: 'again' });
  check('rollback to identical config -> 409', r.status === 409);
  r = await call('admin', 'POST', `/api/admin/records/${ledger}/rollback`, { toVersion: '1.1', reason: 'planned', scheduledAt: inMinutes(30) });
  const rb = r.body.id;
  await call('anoop', 'POST', '/api/change-requests', { operation: 'MODIFY', recordId: ledger, spec: spec('SINGLE', 'ledger.bank.example', ['10.70.0.8']), reason: 'meanwhile' });
  mutate((db) => (db.changeRequests.find((c: any) => c.id === rb).scheduledAt = inMinutes(-1)));
  schedulerTick();
  r = await call('admin', 'GET', `/api/change-requests/${rb}`);
  check('scheduled rollback HELD after record changed', r.body.status === 'HELD' && r.body.canConfirm);
  r = await call('admin', 'POST', `/api/change-requests/${rb}/confirm`, {});
  check('Admin confirms -> applied', r.body.status === 'APPLIED' && r.body.resultVersion === '1.5');
  await call('anoop', 'POST', '/api/change-requests', { operation: 'DELETE', recordId: ledger, reason: 'gone' });
  r = await call('anoop', 'GET', '/api/records?status=DELETED&q=ledger');
  check('deleted records list', r.body.totalElements === 1);
  r = await call('admin', 'POST', `/api/admin/records/${ledger}/rollback`, { toVersion: '1.2', reason: 'restore' });
  check('deleted record restored', r.body.status === 'APPLIED' && data().records.find((x: any) => x.id === ledger).status === 'ACTIVE');

  console.log('== Lockout, disable, partitions');
  for (let i = 0; i < 5; i++) await login('abhash', '140123', 'wrong');
  r = await login('abhash', '140123', '12345677');
  check('locked after 5 failures', r.status === 403 && r.body.message.includes('locked'));
  const abhashId = data().users.find((u: any) => u.username === '140123').id;
  await call('admin', 'POST', `/api/admin/users/${abhashId}/unlock`, {});
  r = await login('abhash', '140123', '12345677');
  check('unlocked by Admin', r.status === 200);
  await call('admin', 'POST', `/api/admin/users/${abhashId}/disable`, {});
  r = await call('abhash', 'GET', '/api/records');
  check("disabled user's session dropped", r.status === 401);
  r = await call('admin', 'POST', '/api/admin/groups', { name: 'Retail Lending' });
  check('partition name with space refused', r.status === 400);
  r = await call('admin', 'POST', '/api/admin/groups', { name: 'core_banking' });
  check('duplicate partition (case-insensitive) -> 409', r.status === 409);
  r = await call('admin', 'DELETE', `/api/admin/groups/${g.Core_Banking.id}`);
  check('partition with records cannot be deleted', r.status === 409);

  console.log('== All-or-nothing and audit');
  const before = data().changeRequests.length;
  r = await call('pravez', 'POST', '/api/change-requests', { operation: 'MODIFY', recordId: cbs.id, spec: spec('MULTI', 'cbs.bank.example', ['10.20.1.11', '10.20.1.13']), reason: 'x' });
  check('denied change leaves no request behind', r.status === 403 && data().changeRequests.length === before);
  check('...but the denied attempt is audited', data().audit.some((e: any) => e.outcome === 'DENIED' && e.actor === '140122'));
  r = await call('admin', 'GET', '/api/admin/audit?q=anoop');
  check('audit search by name', r.body.totalElements > 0);
  r = await call('admin', 'GET', '/api/admin/audit?size=200');
  const created = r.body.content.find((e: any) => e.action === 'USER_CREATED' && e.targetId === '140124');
  check('user events carry ID and name', created?.details?.userId === '140124' && created?.details?.name === 'Anoop Tiwari');
  r = await call('admin', 'GET', '/api/dashboard');
  check('dashboard', r.status === 200 && r.body.health.length === 6 && typeof r.body.totalRecords === 'number');
  r = await call('admin', 'POST', '/api/auth/logout', {});
  r = await call('admin', 'GET', '/api/auth/me');
  check('signed out', r.status === 401);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
