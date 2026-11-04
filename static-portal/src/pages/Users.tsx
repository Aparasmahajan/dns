import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, BookUser, CheckCircle2, ClipboardList, Copy, Info, KeyRound, Lock, Pencil, Search, ShieldCheck, UserCheck, UserPlus, UserX, Users as UsersIcon, XCircle } from 'lucide-react';
import { api, errorMessage, notifyChanged } from '../api';
import { useToast } from '../components/Toast';
import PartitionPicker from '../components/PartitionPicker';
import { Empty, Loading, Modal, UserStatusBadge } from '../components/ui';
import { fmtDateTime, initials, levelLabel, timeAgo } from '../format';
import type { AccessLevel, DirectoryEntry, Group, UserRow, UserWithPassword } from '../types';

type Tab = 'ALL' | 'PENDING' | 'ACTIVE' | 'DISABLED';

const LEVELS: { level: AccessLevel; title: string; desc: string }[] = [
  { level: 'READ', title: 'Read only', desc: 'Sees records and requests in all partitions. Cannot change anything.' },
  { level: 'WRITE', title: 'Read + Write', desc: 'Raises changes in the partitions you pick below. Every change needs approval.' },
  { level: 'CHECKER', title: 'Checker', desc: 'All partitions. Approves Write requests; own changes apply directly.' },
];

const sourceLabel = { CONFIG: 'Configuration', LOCAL: 'Local', LDAP: 'Bank LDAP' } as const;
const USER_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/** Admin types a user ID; the portal looks it up in the Bank directory before any access is granted. */
function DirectoryLookupModal({
  onClose,
  onFound,
  onExisting,
}: {
  onClose: () => void;
  onFound: (entry: DirectoryEntry) => void;
  onExisting: (user: UserRow) => void;
}) {
  const [id, setId] = useState('');
  const [result, setResult] = useState<DirectoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    const value = id.trim().toLowerCase();
    if (!USER_ID_RE.test(value)) {
      setError('Enter the user ID, for example 140124.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.get<DirectoryEntry>(`/api/admin/users/directory/${encodeURIComponent(value)}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canGrant = !!result && result.found && !result.existing;

  return (
    <Modal
      title="Add from Bank directory"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {result?.existing && (
            <button className="btn btn-primary" onClick={() => onExisting(result.existing!)}>
              <Pencil size={16} /> Open {result.existing.displayName || result.existing.username}
            </button>
          )}
          {canGrant && (
            <button className="btn btn-primary" onClick={() => onFound(result!)}>
              <UserCheck size={16} /> Set access
            </button>
          )}
        </>
      }
    >
      <form onSubmit={lookup} noValidate>
        <div className="field">
          <label htmlFor="dir-id">User ID</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="dir-id"
              className="input mono"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setResult(null);
              }}
              placeholder="e.g. 140124"
              autoFocus
            />
            <button type="submit" className="btn" disabled={busy} style={{ flexShrink: 0 }}>
              <Search size={16} /> {busy ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          <span className="hint">The portal checks the ID in the Bank directory (LDAP). The user keeps signing in with their Bank password.</span>
        </div>
      </form>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={17} /> <span>{error}</span>
        </div>
      )}
      {result && result.existing && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Info size={17} />
          <span>
            <strong>{result.username}</strong> already has a portal profile: {result.existing.displayName || result.existing.username} ·{' '}
            {sourceLabel[result.existing.source]} · {levelLabel(result.existing.level)} · {result.existing.status.toLowerCase()}. Open it to change their
            access.
          </span>
        </div>
      )}
      {result && !result.existing && result.found && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <CheckCircle2 size={17} />
          <span>
            Found <strong>{result.displayName || result.username}</strong> ({result.username})
            {result.department ? ` · ${result.department}` : ''}
            {result.email ? ` · ${result.email}` : ''}. Not in the portal yet: choose Set access to give them a role and partitions.
          </span>
        </div>
      )}
      {result && !result.existing && !result.found && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={17} />
          <span>No user with ID {result.username} in the Bank directory. Check the ID, or use Add local user for a portal-only account.</span>
        </div>
      )}
    </Modal>
  );
}

function UserModal({
  user,
  directory,
  groups,
  onClose,
  onSaved,
  onDeclined,
}: {
  user: UserRow | null;
  directory?: DirectoryEntry;
  groups: Group[];
  onClose: () => void;
  onSaved: (result: UserRow | UserWithPassword) => void;
  onDeclined?: () => void;
}) {
  const fromDirectory = !!directory;
  const creating = user === null && !fromDirectory;
  const pending = user?.status === 'PENDING';
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? directory?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? directory?.email ?? '');
  // A user waiting for access: start from what they asked for in their open request.
  const openRequest = user?.status === 'PENDING' && user.accessRequest?.status === 'OPEN' ? user.accessRequest : null;
  const [level, setLevel] = useState<AccessLevel | null>(user && user.level !== 'NONE' ? user.level : (openRequest?.requestedLevel ?? null));
  const [groupIds, setGroupIds] = useState<number[]>(
    user && user.level !== 'NONE' ? user.groups.map((g) => g.id) : (openRequest?.requestedGroups.map((g) => g.id) ?? []),
  );
  const [department, setDepartment] = useState(user?.department ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineComment, setDeclineComment] = useState('');
  const profileEditable = creating || user?.source === 'LOCAL';
  const departmentEditable = user?.source !== 'CONFIG';

  async function decline() {
    if (!declineComment.trim()) return setError('Give the user a reason for declining.');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/users/${user!.id}/decline-request`, { comment: declineComment });
      onDeclined?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!level) return setError('Choose an access level.');
    if (level === 'WRITE' && groupIds.length === 0) return setError('Read + Write access needs at least one partition.');
    if (creating && !USER_ID_RE.test(username.trim().toLowerCase()))
      return setError('Enter the user ID (for example 140122): 3–64 characters, letters, digits, dot, dash or underscore.');
    setBusy(true);
    setError(null);
    try {
      const body = { displayName, email, department, level, groupIds: level === 'WRITE' ? groupIds : [] };
      const result = fromDirectory
        ? await api.post<UserRow>('/api/admin/users/from-directory', { username: directory!.username, department, level, groupIds: body.groupIds })
        : creating
          ? await api.post<UserWithPassword>('/api/admin/users', { ...body, username: username.trim().toLowerCase() })
          : await api.put<UserRow>(`/api/admin/users/${user!.id}`, body);
      onSaved(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = fromDirectory
    ? `Grant access to ${directory!.displayName || directory!.username}`
    : creating
      ? 'Add local user'
      : pending
        ? `Grant access to ${user!.displayName || user!.username}`
        : `Edit ${user!.displayName || user!.username}`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        declining ? (
          <>
            <button className="btn" onClick={() => setDeclining(false)} disabled={busy}>
              Back
            </button>
            <button className="btn btn-danger-solid" onClick={decline} disabled={busy}>
              {busy ? 'Declining…' : 'Decline request'}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            {openRequest && (
              <button className="btn btn-danger" onClick={() => setDeclining(true)}>
                <XCircle size={16} /> Decline request
              </button>
            )}
            <button className="btn btn-primary" type="submit" form="user-form" disabled={busy}>
              {busy ? 'Saving…' : creating ? 'Create user' : pending || fromDirectory ? 'Grant access' : 'Save changes'}
            </button>
          </>
        )
      }
    >
      <form id="user-form" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={17} /> <span>{error}</span>
          </div>
        )}
        {pending && openRequest && (
          <div className="request-box">
            <div className="rb-head">
              <ClipboardList size={17} /> Access request
              <span className="muted">
                {fmtDateTime(openRequest.createdAt)}
                {openRequest.updatedAt !== openRequest.createdAt ? ` · changed ${timeAgo(openRequest.updatedAt)}` : ''}
              </span>
            </div>
            <dl className="kv">
              <dt>Department</dt>
              <dd>{openRequest.department}</dd>
              <dt>Asked for</dt>
              <dd>
                {levelLabel(openRequest.requestedLevel)}
                {openRequest.requestedGroups.map((g) => (
                  <span key={g.id} className="chip mono" style={{ marginLeft: 6 }}>
                    {g.name}
                  </span>
                ))}
              </dd>
              <dt>Reason</dt>
              <dd>{openRequest.reason}</dd>
            </dl>
            <p className="hint" style={{ marginTop: 10 }}>
              The access below starts as requested. Change it if needed, then grant; or decline with a reason the user will see.
            </p>
          </div>
        )}
        {pending && !openRequest && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <ShieldCheck size={17} />
            <span>
              {user!.accessRequest?.status === 'DECLINED'
                ? `Their last request was declined on ${fmtDateTime(user!.accessRequest.decidedAt)} (“${user!.accessRequest.decisionComment}”). They have not raised a new one yet. You can still grant access.`
                : 'This user signed in with the Bank directory but has not raised an access request yet. You can still grant access now.'}
            </span>
          </div>
        )}
        {declining && (
          <div className="field">
            <label htmlFor="decline-comment">Reason for declining (shown to the user)</label>
            <textarea
              id="decline-comment"
              className="textarea"
              value={declineComment}
              onChange={(e) => setDeclineComment(e.target.value)}
              placeholder="e.g. Please ask your manager to confirm the partitions you need"
              autoFocus
            />
          </div>
        )}
        {fromDirectory && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <ShieldCheck size={17} />
            <span>
              Found in the Bank directory{directory!.department ? ` (${directory!.department})` : ''}. They sign in with their Bank password, which the
              portal never stores, and get this access from their first sign-in.
            </span>
          </div>
        )}
        {creating ? (
          <div className="field">
            <label htmlFor="u-name">User ID</label>
            <input id="u-name" className="input mono" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. 140122" autoFocus />
            <span className="hint">The employee ID, used to sign in. A temporary password is generated; the user must change it at first sign-in.</span>
          </div>
        ) : (
          <div className="field">
            <span className="label">User ID</span>
            <div className="mono">
              {fromDirectory ? directory!.username : user!.username}{' '}
              <span className="badge badge-grey" style={{ marginLeft: 6 }}>
                {fromDirectory ? sourceLabel.LDAP : sourceLabel[user!.source]}
              </span>
            </div>
          </div>
        )}
        <div className="row">
          <div className="field">
            <label htmlFor="u-display">Display name</label>
            <input id="u-display" className="input" value={displayName} disabled={!profileEditable} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-email">Email</label>
            <input id="u-email" className="input" type="email" value={email} disabled={!profileEditable} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {!profileEditable && <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>Name and email come from the Bank directory.</p>}
        {departmentEditable && (
          <div className="field">
            <label htmlFor="u-dept">Department</label>
            <input
              id="u-dept"
              className="input"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder={openRequest ? '' : 'e.g. Network Operations'}
            />
            {(user?.source === 'LDAP' || fromDirectory) && <span className="hint">Kept by the portal: the Bank directory does not provide it.</span>}
          </div>
        )}

        <div className="field">
          <span className="label">Access level</span>
          <div className="options">
            {LEVELS.map((l) => (
              <button type="button" key={l.level} className={`option${level === l.level ? ' active' : ''}`} onClick={() => setLevel(l.level)}>
                <span className="o-title">{l.title}</span>
                <span className="o-desc">{l.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {level === 'WRITE' && (
          <PartitionPicker
            label="Partitions this user can change"
            items={groups}
            selected={groupIds}
            onChange={setGroupIds}
            empty="No partitions exist yet. Create one under Partitions first."
          />
        )}
        {(level === 'READ' || level === 'CHECKER') && <p className="hint" style={{ marginBottom: 16 }}>{levelLabel(level)} always covers all partitions.</p>}
      </form>
    </Modal>
  );
}

function TempPasswordModal({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal
      title="Temporary password"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p style={{ marginBottom: 14 }}>
        Give this password to <strong>{username}</strong> through a secure channel. It is shown only once. They must set a new password when they first
        sign in.
      </p>
      <div className="temp-pass" style={{ marginBottom: 18 }}>
        <span>{password}</span>
        <button
          className="btn btn-sm"
          onClick={() =>
            navigator.clipboard
              .writeText(password)
              .then(() => toast.success('Copied.'))
              .catch(() => toast.error('Copy failed. Select the text instead.'))
          }
        >
          <Copy size={14} /> Copy
        </button>
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<UserRow | 'new' | { directory: DirectoryEntry } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'disable' | 'reset'; user: UserRow } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api
      .get<UserRow[]>('/api/admin/users')
      .then((list) => {
        setUsers(list);
        setTab((t) => t ?? (list.some((u) => u.status === 'PENDING') ? 'PENDING' : 'ALL'));
      })
      .catch((e) => toast.error(errorMessage(e)));
    api.get<Group[]>('/api/groups').then(setGroups).catch(() => setGroups([]));
  }, [reload, toast]);

  const counts = useMemo(() => {
    const c = { ALL: 0, PENDING: 0, ACTIVE: 0, DISABLED: 0 };
    users?.forEach((u) => {
      c.ALL++;
      c[u.status]++;
    });
    return c;
  }, [users]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        (tab === 'ALL' || tab === null || u.status === tab) &&
        (!term || u.username.includes(term) || (u.displayName ?? '').toLowerCase().includes(term) || (u.email ?? '').toLowerCase().includes(term)),
    );
  }, [users, tab, search]);

  async function action(user: UserRow, kind: 'disable' | 'enable' | 'unlock' | 'reset') {
    try {
      if (kind === 'reset') {
        const r = await api.post<UserWithPassword>(`/api/admin/users/${user.id}/reset-password`);
        setTemp({ username: r.user.username, password: r.temporaryPassword });
      } else {
        await api.post<UserRow>(`/api/admin/users/${user.id}/${kind}`);
        toast.success(`${user.username} ${kind === 'disable' ? 'disabled' : kind === 'enable' ? 'enabled' : 'unlocked'}.`);
      }
      setConfirm(null);
      setReload((x) => x + 1);
      notifyChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function onSaved(result: UserRow | UserWithPassword) {
    setEditing(null);
    if ('temporaryPassword' in result) {
      setTemp({ username: result.user.username, password: result.temporaryPassword });
      toast.success(`User ${result.user.username} created.`);
    } else if (result.source === 'LDAP' && editing && typeof editing === 'object' && 'directory' in editing) {
      toast.success(`${result.displayName || result.username} (${result.username}) can now sign in with their Bank password.`);
    } else {
      toast.success(`Access for ${result.username} saved.`);
    }
    setReload((x) => x + 1);
    notifyChanged();
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'ALL', label: 'All users' },
    { key: 'PENDING', label: 'Pending access' },
    { key: 'ACTIVE', label: 'Active' },
    { key: 'DISABLED', label: 'Disabled' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Administration</div>
          <h1>Users &amp; Access</h1>
          <div className="sub">
            Find Bank users by ID and give them access, approve first-time directory sign-ins, create local users, and assign roles and partitions.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditing('new')} style={{ height: 42 }}>
            <UserPlus size={17} /> Add local user
          </button>
          <button className="btn btn-primary" onClick={() => setLookingUp(true)} style={{ height: 42 }}>
            <BookUser size={17} /> Add from Bank directory
          </button>
        </div>
      </div>

      <div className="card">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === 'PENDING' ? counts.PENDING > 0 && <span className="count-pill">{counts.PENDING}</span> : <span className="muted">{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input className="input" placeholder="Search user ID, name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
          </div>
        </div>

        {!users ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty title={tab === 'PENDING' ? 'No one is waiting for access' : 'No users found'} icon={<UsersIcon size={34} />} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Source</th>
                  <th>Access</th>
                  <th>Partitions</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <span className="avatar avatar-light">{initials(u.displayName || u.username)}</span>
                        <div>
                          <div className="cell-main">{u.displayName || u.username}</div>
                          <div className="cell-sub mono">{u.username}</div>
                          {(u.department || u.email) && <div className="cell-sub">{[u.department, u.email].filter(Boolean).join(' · ')}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${u.source === 'LDAP' ? 'badge-blue' : u.source === 'CONFIG' ? 'badge-navy' : 'badge-grey'}`}>{sourceLabel[u.source]}</span>
                    </td>
                    <td className="nowrap">
                      {u.status === 'PENDING' ? (
                        u.accessRequest?.status === 'OPEN' ? (
                          <>
                            <span className="badge badge-amber">Requested</span> {levelLabel(u.accessRequest.requestedLevel)}
                            <div className="cell-sub">{timeAgo(u.accessRequest.updatedAt)}</div>
                          </>
                        ) : u.accessRequest?.status === 'DECLINED' ? (
                          <span className="muted">Request declined</span>
                        ) : (
                          <span className="muted">No request yet</span>
                        )
                      ) : (
                        levelLabel(u.level)
                      )}
                    </td>
                    <td>
                      {u.status === 'PENDING' && u.accessRequest?.status === 'OPEN' && u.accessRequest.requestedGroups.length > 0 ? (
                        u.accessRequest.requestedGroups.map((g) => (
                          <span key={g.id} className="chip" title="Requested">
                            {g.name}
                          </span>
                        ))
                      ) : u.status === 'PENDING' ? (
                        <span className="muted">—</span>
                      ) : u.allGroups ? (
                        <span className="muted">All partitions</span>
                      ) : u.groups.length ? (
                        u.groups.map((g) => (
                          <span key={g.id} className="chip">
                            {g.name}
                          </span>
                        ))
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <UserStatusBadge status={u.status} locked={u.locked} />
                      {u.mustChangePassword && u.status === 'ACTIVE' && <div className="cell-sub">Must change password</div>}
                    </td>
                    <td className="muted nowrap" title={fmtDateTime(u.lastLoginAt)}>
                      {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}
                    </td>
                    <td className="actions">
                      {u.managedByConfig ? (
                        <span className="muted small">Managed in configuration</span>
                      ) : (
                        <>
                          {u.status === 'PENDING' ? (
                            <button className="btn btn-sm btn-primary" onClick={() => setEditing(u)}>
                              <UserCheck size={15} /> Grant access
                            </button>
                          ) : (
                            u.status !== 'DISABLED' && (
                              <button className="btn btn-ghost btn-icon" title="Edit access" aria-label={`Edit ${u.username}`} onClick={() => setEditing(u)}>
                                <Pencil size={16} />
                              </button>
                            )
                          )}
                          {u.locked && (
                            <button className="btn btn-ghost btn-icon" title="Unlock" aria-label={`Unlock ${u.username}`} onClick={() => action(u, 'unlock')}>
                              <Lock size={16} />
                            </button>
                          )}
                          {u.source === 'LOCAL' && u.status !== 'DISABLED' && (
                            <button className="btn btn-ghost btn-icon" title="Reset password" aria-label={`Reset password for ${u.username}`} onClick={() => setConfirm({ kind: 'reset', user: u })}>
                              <KeyRound size={16} />
                            </button>
                          )}
                          {u.status === 'DISABLED' ? (
                            <button className="btn btn-sm" onClick={() => action(u, 'enable')}>
                              Enable
                            </button>
                          ) : (
                            <button className="btn btn-ghost btn-icon" title={u.status === 'PENDING' ? 'Reject (disable)' : 'Disable'} aria-label={`Disable ${u.username}`} onClick={() => setConfirm({ kind: 'disable', user: u })}>
                              <UserX size={16} />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lookingUp && (
        <DirectoryLookupModal
          onClose={() => setLookingUp(false)}
          onFound={(entry) => {
            setLookingUp(false);
            setEditing({ directory: entry });
          }}
          onExisting={(existing) => {
            setLookingUp(false);
            setEditing(users?.find((u) => u.id === existing.id) ?? existing);
          }}
        />
      )}
      {editing && (
        <UserModal
          user={editing === 'new' || 'directory' in editing ? null : editing}
          directory={editing !== 'new' && 'directory' in editing ? editing.directory : undefined}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onDeclined={() => {
            const who = editing !== 'new' && !('directory' in editing) ? editing.displayName || editing.username : 'the user';
            setEditing(null);
            toast.success(`Request from ${who} declined. They can raise a new one.`);
            setReload((x) => x + 1);
            notifyChanged();
          }}
        />
      )}
      {temp && <TempPasswordModal username={temp.username} password={temp.password} onClose={() => setTemp(null)} />}
      {confirm && (
        <Modal
          title={confirm.kind === 'disable' ? `Disable ${confirm.user.username}?` : `Reset password for ${confirm.user.username}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className={`btn ${confirm.kind === 'disable' ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => action(confirm.user, confirm.kind)}>
                {confirm.kind === 'disable' ? 'Disable user' : 'Reset password'}
              </button>
            </>
          }
        >
          <p style={{ marginBottom: 16 }}>
            {confirm.kind === 'disable'
              ? 'The user is signed out on their next click and cannot sign in until you enable them again. Their history is kept.'
              : 'A new temporary password is generated and the old one stops working. The user must set a new password at next sign-in.'}
          </p>
        </Modal>
      )}
    </>
  );
}
