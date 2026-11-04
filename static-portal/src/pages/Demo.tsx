import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Download, Info, RotateCcw, Trash2, Upload, UserPlus } from 'lucide-react';
import { api, errorMessage, notifyChanged } from '../api';
import { useToast } from '../components/Toast';
import { Loading, Modal, UserStatusBadge } from '../components/ui';
import { levelLabel } from '../format';
import type { AccessLevel, UserStatus } from '../types';

interface DemoInfo {
  settings: { siteRole: 'Active' | 'Standby'; ldapEnabled: boolean; f5FailSuffix: string };
  directory: { uid: string; name: string; email: string | null; portalStatus: UserStatus | null; portalLevel: AccessLevel | null }[];
  storageBytes: number;
  counts: { users: number; partitions: number; records: number; changeRequests: number; auditEvents: number };
}

/** Static demo only: what the Docker version does with scripts and .env settings. */
export default function DemoPage() {
  const toast = useToast();
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [form, setForm] = useState({ uid: '', name: '', email: '', password: '12345677' });
  const [suffix, setSuffix] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () =>
    api
      .get<DemoInfo>('/api/admin/demo')
      .then((d) => {
        setInfo(d);
        setSuffix(d.settings.f5FailSuffix);
      })
      .catch((e) => toast.error(errorMessage(e)));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    try {
      setInfo(await api.post<DemoInfo>('/api/admin/demo/directory', form));
      toast.success(`${form.uid} added to the mock Bank directory. They can sign in now.`);
      setForm({ uid: '', name: '', email: '', password: '12345677' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function removeUser(uid: string) {
    try {
      setInfo(await api.del<DemoInfo>(`/api/admin/demo/directory/${encodeURIComponent(uid)}`));
      toast.success(`${uid} removed from the directory. If they have a portal profile, disable it under Users & Access.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function saveSettings(changes: Partial<DemoInfo['settings']>) {
    try {
      const d = await api.put<DemoInfo>('/api/admin/demo/settings', { ...info!.settings, ...changes });
      setInfo(d);
      setSuffix(d.settings.f5FailSuffix);
      toast.success('Demo settings saved.');
      notifyChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function exportData() {
    try {
      const data = await api.get<unknown>('/api/admin/demo/export');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dns-portal-demo-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function importData(file: File) {
    try {
      const data = JSON.parse(await file.text());
      await api.post('/api/admin/demo/import', { data });
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'That file is not valid JSON.' : errorMessage(err));
    }
  }

  async function resetData() {
    await api.post('/api/public/demo/reset');
    window.location.hash = '#/';
    window.location.reload();
  }

  if (!info) return <Loading />;
  const s = info.settings;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Administration</div>
          <h1>Demo data</h1>
          <div className="sub">
            This is the static demo: there is no server and everything is stored in this browser. Use this page for what the real portal does with
            scripts and configuration.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Mock Bank directory (LDAP)</h3>
          <span className="muted small right">Holds ID, name, email and password only, like the Bank’s directory</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>In the portal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {info.directory.map((d) => (
                <tr key={d.uid}>
                  <td className="mono">{d.uid}</td>
                  <td>{d.name}</td>
                  <td className="muted">{d.email ?? '—'}</td>
                  <td>
                    {d.portalStatus ? (
                      <>
                        <UserStatusBadge status={d.portalStatus} /> {d.portalLevel && d.portalLevel !== 'NONE' ? <span className="small">{levelLabel(d.portalLevel)}</span> : null}
                      </>
                    ) : (
                      <span className="muted">Never signed in</span>
                    )}
                  </td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-icon" title="Remove from directory" aria-label={`Remove ${d.uid}`} onClick={() => removeUser(d.uid)}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card-body" onSubmit={addUser} noValidate style={{ borderTop: '1px solid var(--border)' }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="d-uid">User ID</label>
              <input id="d-uid" className="input mono" placeholder="140127" value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="d-name">Name</label>
              <input id="d-name" className="input" placeholder="Neha Sharma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="d-email">Email (optional)</label>
              <input id="d-email" className="input" placeholder="neha.sharma@bank.local" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="d-pass">Password</label>
              <input id="d-pass" className="input mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <button type="submit" className="btn btn-primary" style={{ height: 40 }}>
                <UserPlus size={16} /> Add to directory
              </button>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            A new directory user can sign in straight away; their first sign-in raises an access request. Or grant access first under Users &amp; Access →
            Add from Bank directory.
          </p>
        </form>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Behaviour</h3>
          </div>
          <div className="card-body">
            <div className="field">
              <span className="label">This site’s role</span>
              <div className="segmented" role="group" aria-label="Site role">
                {(['Active', 'Standby'] as const).map((role) => (
                  <button key={role} className={s.siteRole === role ? 'active' : ''} onClick={() => s.siteRole !== role && saveSettings({ siteRole: role })}>
                    {role}
                  </button>
                ))}
              </div>
              <span className="hint">Only the Active site runs scheduled changes. Set Standby to see due jobs wait, like the DR site.</span>
            </div>
            <div className="field">
              <label className="checkbox">
                <input type="checkbox" checked={s.ldapEnabled} onChange={(e) => saveSettings({ ldapEnabled: e.target.checked })} /> Bank directory sign-in
                enabled
              </label>
              <span className="hint">Off: only the Admin and local portal accounts can sign in.</span>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="d-suffix">Mock F5 rejects domains ending with</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="d-suffix" className="input mono" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="(none)" />
                <button className="btn" onClick={() => saveSettings({ f5FailSuffix: suffix })} disabled={suffix === s.f5FailSuffix}>
                  Save
                </button>
              </div>
              <span className="hint">The change then fails at the DR site, so the per-site F5 error display can be shown. Empty: nothing fails.</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Data in this browser</h3>
            <span className="muted small right">{(info.storageBytes / 1024).toFixed(0)} KB of about 5 MB</span>
          </div>
          <div className="card-body">
            <dl className="kv" style={{ marginBottom: 18 }}>
              <dt>Users</dt>
              <dd>{info.counts.users}</dd>
              <dt>Partitions</dt>
              <dd>{info.counts.partitions}</dd>
              <dt>DNS records</dt>
              <dd>{info.counts.records}</dd>
              <dt>Change requests</dt>
              <dd>{info.counts.changeRequests}</dd>
              <dt>Audit events</dt>
              <dd>{info.counts.auditEvents} (the newest 5,000 are kept)</dd>
            </dl>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={exportData}>
                <Download size={16} /> Export (JSON)
              </button>
              <button className="btn" onClick={() => fileInput.current?.click()}>
                <Upload size={16} /> Import…
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importData(f);
                  e.target.value = '';
                }}
              />
              <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={16} /> Reset to sample data
              </button>
            </div>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              <Info size={17} />
              <span>Export to keep a copy or move the demo to another browser. Importing replaces everything and signs everyone out.</span>
            </div>
          </div>
        </div>
      </div>

      {confirmReset && (
        <Modal
          title="Reset to sample data?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="btn btn-danger-solid" onClick={resetData}>
                Reset everything
              </button>
            </>
          }
        >
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <AlertTriangle size={17} />
            <span>All users, partitions, records, requests and audit events in this browser are replaced by the sample data. You are signed out.</span>
          </div>
        </Modal>
      )}
    </>
  );
}
