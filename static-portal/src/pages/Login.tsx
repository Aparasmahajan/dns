import { useState, type FormEvent } from 'react';
import { AlertTriangle, Eye, EyeOff, Loader2, RotateCcw } from 'lucide-react';
import { useAuth } from '../auth';
import { api, errorMessage } from '../api';
import { Brand } from '../components/ui';

/** Static demo: sample accounts (all data lives in this browser). */
const DEMO_ACCOUNTS: { id: string; password: string; name: string; note: string }[] = [
  { id: 'admin', password: 'Admin@Portal2026', name: 'Portal Administrator', note: 'Admin' },
  { id: '140122', password: '12345677', name: 'Pravez', note: 'Read + Write · local' },
  { id: '140123', password: '12345677', name: 'Abhash', note: 'Read + Write · local' },
  { id: '140124', password: '12345677', name: 'Anoop Tiwari', note: 'Bank directory · Admin grants Checker' },
  { id: '140125', password: '12345677', name: 'Rahul KP', note: 'Bank directory · Admin grants Checker' },
  { id: '140126', password: '12345677', name: 'Paras Mahajan', note: 'Bank directory · raises an access request' },
];

export default function LoginPage() {
  const { login, config } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resetDemo() {
    if (!window.confirm('Reset the demo? All changes made in this browser are replaced by the sample data.')) return;
    await api.post('/api/public/demo/reset');
    window.location.reload();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Enter your user ID and password.');
      return;
    }
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-hero">
        <Brand title={config.orgName} subtitle={config.portalName} />
        <h1>Centralized DNS management for F5 BIG-IP DNS.</h1>
        <p className="lead">
          One governed front end for DNS records across DC, DR and AZ: permission-based access, maker–checker
          approval, validation before every change and a complete audit trail.
        </p>
        <ul>
          <li>
            <span className="dot dot-green" /> Portal accounts and Bank directory (LDAP) sign-in
          </li>
          <li>
            <span className="dot dot-green" /> Read, Write and Checker access by F5 partition
          </li>
          <li>
            <span className="dot dot-green" /> Every sign-in and change recorded in the audit trail
          </li>
        </ul>
        <div className="foot">Static demo · no server: all data is kept in this browser (localStorage). Do not enter real passwords.</div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-mobile-brand">
            <Brand title={config.orgName} subtitle={config.portalName} />
          </div>
          <h2>Sign in</h2>
          <p className="sub">Use your portal account or your Bank directory credentials.</p>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 18 }} role="alert">
              <AlertTriangle size={17} /> <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="username">User ID</label>
            <input
              id="username"
              className="input input-lg"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 24 }}>
            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <input
                id="password"
                className="input input-lg"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon reveal"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : null}
            {busy ? 'Signing in…' : 'Continue'}
          </button>

          <div className="meta">
            <span>
              Portal v{config.version || '—'}
              {config.siteName ? ` · ${config.siteName}` : ''}
            </span>
            <span>Forgot your password? Contact the portal Admin.</span>
          </div>

          <div className="demo-accounts">
            <div className="da-head">
              <strong>Demo accounts</strong>
              <span className="muted small">click one to fill in</span>
            </div>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                type="button"
                key={a.id}
                className="da-row"
                onClick={() => {
                  setUsername(a.id);
                  setPassword(a.password);
                  setError(null);
                }}
              >
                <span className="mono">{a.id}</span>
                <span>{a.name}</span>
                <span className="muted small">{a.note}</span>
              </button>
            ))}
            <div className="da-foot">
              <span className="muted small">
                Password <span className="mono">12345677</span> (Admin: <span className="mono">Admin@Portal2026</span>)
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetDemo}>
                <RotateCcw size={14} /> Reset demo data
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
