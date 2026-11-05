import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Hourglass, LogOut, Pencil, RefreshCw, Send, XCircle } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth, useMe } from '../auth';
import DepartmentSelect from '../components/DepartmentSelect';
import PartitionPicker from '../components/PartitionPicker';
import { Brand, Loading } from '../components/ui';
import { fmtDateTime, levelLabel } from '../format';
import type { AccessLevel, AccessRequest, MyAccessRequest } from '../types';

const LEVELS: { level: AccessLevel; title: string; desc: string }[] = [
  { level: 'READ', title: 'Read only', desc: 'View and search DNS records and requests in all partitions.' },
  { level: 'WRITE', title: 'Read + Write', desc: 'Raise DNS changes in the partitions you pick below. A Checker approves each change.' },
  { level: 'CHECKER', title: 'Checker', desc: 'All partitions. Approve other users’ changes; your own changes apply directly.' },
];

interface FormState {
  department: string;
  level: AccessLevel | null;
  groupIds: number[];
  reason: string;
}

function fromRequest(r: AccessRequest | null, department: string | null): FormState {
  return {
    department: r?.department ?? department ?? '',
    level: r?.requestedLevel ?? null,
    groupIds: r?.requestedGroups.map((g) => g.id) ?? [],
    reason: r?.reason ?? '',
  };
}

/**
 * First sign-in of a Bank (LDAP) user: the directory confirmed who they are, but the portal has no access for them.
 * They raise an access request (department, access needed, partitions, reason) and wait for the Admin.
 */
export default function PendingAccess() {
  const { config, logout, refresh } = useAuth();
  const me = useMe();
  const [view, setView] = useState<MyAccessRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => fromRequest(null, me.department));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    api
      .get<MyAccessRequest>('/api/access-requests/mine')
      .then((v) => {
        setView(v);
        const open = v.request?.status === 'OPEN';
        setEditing(!open);
        // A declined request pre-fills the next one; an open one is shown as a summary.
        setForm(fromRequest(v.request, me.department));
      })
      .catch((e) => setLoadError(errorMessage(e)));
  }, [me.department]);

  useEffect(load, [load]);

  async function checkAgain() {
    setChecking(true);
    try {
      await refresh();
      load();
    } finally {
      setChecking(false);
    }
  }

  const errors: Record<string, string> = {};
  if (form.department.trim().length < 2) errors.department = 'Choose your department.';
  if (!form.level) errors.level = 'Choose the access you need.';
  if (form.level === 'WRITE' && form.groupIds.length === 0) errors.groups = 'Choose at least one partition.';
  if (!form.reason.trim()) errors.reason = 'Say why you need this access.';
  const show = (k: string) => (tried ? errors[k] : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const request = await api.post<AccessRequest>('/api/access-requests', {
        department: form.department,
        level: form.level,
        groupIds: form.level === 'WRITE' ? form.groupIds : [],
        reason: form.reason,
      });
      setView((v) => (v ? { ...v, request } : v));
      setEditing(false);
      setTried(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const request = view?.request ?? null;
  const open = request?.status === 'OPEN';
  const declined = request?.status === 'DECLINED';
  const partitions = view?.partitions ?? [];

  return (
    <div className="center-screen">
      <div className="topbar">
        <Brand title={config.orgName} subtitle={config.portalName} />
      </div>
      <div className="center-body">
        <div className="card center-card" style={{ maxWidth: 720 }}>
          <div className={`icon-circle ${open ? 'amber' : declined ? 'red' : 'amber'}`}>
            {open ? <Hourglass size={24} /> : declined ? <XCircle size={24} /> : <Send size={24} />}
          </div>
          <h2>{open && !editing ? 'Access request sent' : 'Request portal access'}</h2>
          <p className="muted" style={{ marginBottom: 18, lineHeight: 1.6 }}>
            Hello {me.displayName || me.username} ({me.username}). The Bank directory confirmed your sign-in, but you do not have portal access yet.
            {open && !editing
              ? ' Your request is with the portal Admin. You will see the DNS records as soon as it is granted.'
              : ' Tell the Admin which department you are in and what access you need.'}
          </p>

          {loadError && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <AlertTriangle size={17} /> <span>{loadError}</span>
            </div>
          )}
          {!view && !loadError && <Loading />}

          {declined && editing && (
            <div className="alert alert-error" style={{ marginBottom: 18 }}>
              <XCircle size={17} />
              <span>
                Your previous request was declined{request?.decidedBy ? ` by ${request.decidedBy}` : ''} on {fmtDateTime(request?.decidedAt)}:{' '}
                <strong>{request?.decisionComment}</strong>. You can raise a new request below.
              </span>
            </div>
          )}

          {view && open && !editing && request && (
            <>
              <div className="alert alert-success" style={{ marginBottom: 18 }}>
                <CheckCircle2 size={17} />
                <span>
                  Sent on {fmtDateTime(request.createdAt)}
                  {request.updatedAt !== request.createdAt ? ` · last changed ${fmtDateTime(request.updatedAt)}` : ''}. It is waiting in the Admin’s
                  Pending access list.
                </span>
              </div>
              <dl className="kv" style={{ marginBottom: 24 }}>
                <dt>User ID</dt>
                <dd className="mono">{me.username}</dd>
                {me.email && (
                  <>
                    <dt>Email</dt>
                    <dd>{me.email}</dd>
                  </>
                )}
                <dt>Department</dt>
                <dd>{request.department}</dd>
                <dt>Access needed</dt>
                <dd>{levelLabel(request.requestedLevel)}</dd>
                {request.requestedLevel === 'WRITE' && (
                  <>
                    <dt>Partitions</dt>
                    <dd>
                      {request.requestedGroups.map((g) => (
                        <span key={g.id} className="chip mono">
                          {g.name}
                        </span>
                      ))}
                    </dd>
                  </>
                )}
                <dt>Reason</dt>
                <dd>{request.reason}</dd>
              </dl>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={checkAgain} disabled={checking}>
                  <RefreshCw size={16} className={checking ? 'spin' : ''} /> Check again
                </button>
                <button className="btn" onClick={() => setEditing(true)}>
                  <Pencil size={16} /> Edit request
                </button>
                <button className="btn" onClick={() => logout()}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </>
          )}

          {view && editing && (
            <form onSubmit={submit} noValidate>
              {error && (
                <div className="alert alert-error" style={{ marginBottom: 16 }}>
                  <AlertTriangle size={17} /> <span>{error}</span>
                </div>
              )}
              <div className="field">
                <label htmlFor="ar-dept">Department</label>
                <DepartmentSelect
                  id="ar-dept"
                  value={form.department}
                  onChange={(department) => setForm({ ...form, department })}
                  departments={config.departments}
                  invalid={!!show('department')}
                  autoFocus
                />
                {show('department') && <span className="error-text">{show('department')}</span>}
              </div>

              <div className="field">
                <span className="label">Access needed</span>
                <div className="options">
                  {LEVELS.map((l) => (
                    <button type="button" key={l.level} className={`option${form.level === l.level ? ' active' : ''}`} onClick={() => setForm({ ...form, level: l.level })}>
                      <span className="o-title">{l.title}</span>
                      <span className="o-desc">{l.desc}</span>
                    </button>
                  ))}
                </div>
                {show('level') && <span className="error-text">{show('level')}</span>}
              </div>

              {form.level === 'WRITE' && (
                <PartitionPicker
                  label="Partitions you need to change"
                  items={partitions}
                  selected={form.groupIds}
                  onChange={(groupIds) => setForm({ ...form, groupIds })}
                  empty="No partitions exist yet. Ask for Read only for now, or mention the partition in the reason."
                  error={show('groups')}
                />
              )}

              <div className="field">
                <label htmlFor="ar-reason">Reason</label>
                <textarea
                  id="ar-reason"
                  className={`textarea${show('reason') ? ' invalid' : ''}`}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="e.g. I manage DNS for the internet banking applications"
                />
                {show('reason') && <span className="error-text">{show('reason')}</span>}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Send size={16} /> {busy ? 'Sending…' : open ? 'Update request' : 'Send request'}
                </button>
                {open && (
                  <button type="button" className="btn" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
                <button type="button" className="btn" onClick={() => logout()}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
