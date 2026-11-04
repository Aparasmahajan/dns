import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ClipboardCheck,
  Database,
  FolderTree,
  History,
  KeyRound,
  LayoutDashboard,
  ListTree,
  LogOut,
  Search,
  Users,
} from 'lucide-react';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { initials, isAdmin, isChecker, levelLabel } from '../format';
import type { Counters } from '../types';
import { Brand } from './ui';

export default function Layout({ children }: { children: ReactNode }) {
  const { config, logout } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [counters, setCounters] = useState<Counters | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<Counters>('/api/dashboard/counters')
        .then((c) => alive && setCounters(c))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener('portal:changed', load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('portal:changed', load);
    };
  }, [location.pathname]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/records?q=${encodeURIComponent(q)}` : '/records');
  }

  const name = me.displayName || me.username;
  // Checkers: requests waiting for them. Admin: plus held rollbacks. Write users: their own pending requests.
  const requestBadge = isChecker(me) ? (counters?.awaitingApproval ?? 0) + (counters?.held ?? 0) : counters?.myPending;
  const scope = me.allGroups ? 'All partitions' : `${me.groups.length} partition${me.groups.length === 1 ? '' : 's'}`;

  return (
    <div className="app">
      <header className="app-header">
        <Brand title={config.orgName} subtitle={config.portalName} />
        <form className="header-search" onSubmit={onSearch} role="search">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search records by domain or IP…"
            aria-label="Search DNS records"
          />
        </form>
        <div className="header-right">
          {config.siteName && (
            <span className="site-pill" title="Portal site serving this session">
              <span className="dot dot-green" /> {config.siteName} · {config.siteRole}
            </span>
          )}
          <button className="user-chip" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <span className="avatar">{initials(name)}</span>
            <span className="user-meta">
              <strong>{name}</strong>
              <small>
                {levelLabel(me.level)} · {scope}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          {menuOpen && (
            <>
              <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <div className="menu-head">
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="small muted">
                    {me.username} · {me.source === 'LDAP' ? 'Bank directory' : me.source === 'CONFIG' ? 'Configuration account' : 'Local account'}
                  </div>
                  {!me.allGroups && me.groups.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {me.groups.map((g) => (
                        <span key={g.id} className="chip">
                          {g.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {me.source === 'LOCAL' && (
                  <button className="menu-item" role="menuitem" onClick={() => navigate('/account/password')}>
                    <KeyRound size={16} /> Change password
                  </button>
                )}
                <button className="menu-item" role="menuitem" onClick={() => logout()}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <LayoutDashboard size={19} /> Dashboard
          </NavLink>

          <div className="nav-section">DNS</div>
          <NavLink to="/records" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <ListTree size={19} /> DNS Records
          </NavLink>
          <NavLink to="/requests" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <ClipboardCheck size={19} /> Change Requests
            {!!requestBadge && <span className="count-pill">{requestBadge}</span>}
          </NavLink>
          <NavLink to="/groups" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <FolderTree size={19} /> Partitions
          </NavLink>

          {isAdmin(me) && (
            <>
              <div className="nav-section">Administration</div>
              <NavLink to="/users" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Users size={19} /> Users &amp; Access
                {!!counters?.pendingUsers && <span className="count-pill">{counters.pendingUsers}</span>}
              </NavLink>
              <NavLink to="/audit" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <History size={19} /> Audit Trail
              </NavLink>
              <NavLink to="/demo" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Database size={19} /> Demo data
              </NavLink>
            </>
          )}

          <div className="sidebar-foot">
            Portal v{config.version || '—'}
            {config.siteName ? ` · ${config.siteName}` : ''}
            <br />
            Static demo · data in this browser
          </div>
        </nav>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
