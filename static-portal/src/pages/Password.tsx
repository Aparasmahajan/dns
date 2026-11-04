import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Circle, KeyRound, LogOut } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth, useMe } from '../auth';
import { useToast } from '../components/Toast';
import { Brand } from '../components/ui';
import type { Me } from '../types';

function PasswordForm({ onDone, submitLabel }: { onDone?: () => void; submitLabel: string }) {
  const { config, setMe } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const min = config.passwordMinLength || 12;
  const checks: [string, boolean][] = [
    [`At least ${min} characters`, next.length >= min],
    ['An upper-case letter', /[A-Z]/.test(next)],
    ['A lower-case letter', /[a-z]/.test(next)],
    ['A digit', /\d/.test(next)],
    ['A special character', /[^A-Za-z0-9]/.test(next)],
    ['Both new passwords match', next.length > 0 && next === confirm],
  ];
  const ready = current.length > 0 && checks.every(([, ok]) => ok);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<Me>('/api/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password changed.');
      setMe(updated);
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }} role="alert">
          <AlertTriangle size={17} /> <span>{error}</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="current">Current password</label>
        <input id="current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="next">New password</label>
        <input id="next" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirm new password</label>
        <input id="confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <ul className="checklist">
          {checks.map(([label, ok]) => (
            <li key={label} className={ok ? 'ok' : ''}>
              {ok ? <Check size={13} /> : <Circle size={11} />} {label}
            </li>
          ))}
        </ul>
      </div>
      <button className="btn btn-primary" type="submit" disabled={!ready || busy} style={{ width: '100%', height: 44 }}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

/** Shown after first login with a temporary password, after an Admin reset, or when the password expired. */
export function ForcedPasswordChange() {
  const { config, logout } = useAuth();
  const me = useMe();
  return (
    <div className="center-screen">
      <div className="topbar">
        <Brand title={config.orgName} subtitle={config.portalName} />
      </div>
      <div className="center-body">
        <div className="card center-card">
          <div className="icon-circle navy">
            <KeyRound size={24} />
          </div>
          <h2>Set a new password</h2>
          <p className="muted" style={{ marginBottom: 22 }}>
            Hello {me.displayName || me.username}. Your password is temporary or has expired. Choose a new one to continue.
          </p>
          <PasswordForm submitLabel="Save password and continue" />
          <div style={{ marginTop: 18, textAlign: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => logout()}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AccountPasswordPage() {
  const me = useMe();
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Account</div>
          <h1>Change password</h1>
          <div className="sub">Applies to your local portal account ({me.username}).</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card-body">
          {me.source === 'LOCAL' ? (
            <PasswordForm submitLabel="Change password" onDone={() => navigate('/')} />
          ) : (
            <div className="alert alert-info">
              {me.source === 'LDAP'
                ? 'Your password is managed by the Bank directory. Change it there.'
                : 'The Admin password is managed in the portal configuration (.env or Vault).'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
