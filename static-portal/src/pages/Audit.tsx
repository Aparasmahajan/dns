import { useEffect, useState } from 'react';
import { History, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useToast } from '../components/Toast';
import { Empty, Loading, Pager } from '../components/ui';
import { fmtDateTime } from '../format';
import type { AuditRow, Page } from '../types';

function outcomeBadge(o: AuditRow['outcome']) {
  if (o === 'SUCCESS') return <span className="badge badge-green">Success</span>;
  if (o === 'DENIED') return <span className="badge badge-amber">Denied</span>;
  return <span className="badge badge-red">Failure</span>;
}

export default function AuditPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<AuditRow> | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    setData(null);
    const query = new URLSearchParams({ page: String(page), size: '50' });
    if (q) query.set('q', q);
    if (outcome) query.set('outcome', outcome);
    api
      .get<Page<AuditRow>>(`/api/admin/audit?${query}`)
      .then((d) => alive && setData(d))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [q, outcome, page, toast]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Administration</div>
          <h1>Audit Trail</h1>
          <div className="sub">Every sign-in, access change and DNS change. The same events are shipped to the SIEM by Fluent Bit.</div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input className="input" placeholder="Search user ID, name, action or details" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search audit" />
          </div>
          <select
            className="select"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(0);
            }}
            aria-label="Filter by outcome"
          >
            <option value="">All outcomes</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </select>
        </div>
        {!data ? (
          <Loading />
        ) : data.content.length === 0 ? (
          <Empty title="No audit events match" icon={<History size={34} />} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Outcome</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th>Client IP</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((e) => (
                  <tr key={e.id} className={e.details ? 'clickable' : undefined} onClick={() => e.details && setExpanded(expanded === e.id ? null : e.id)}>
                    <td className="nowrap small">{fmtDateTime(e.at)}</td>
                    <td className="mono small">{e.actor ?? '—'}</td>
                    <td className="mono small">{e.action}</td>
                    <td>{outcomeBadge(e.outcome)}</td>
                    <td className="small">
                      {e.targetType && <span className="muted">{e.targetType === 'USER' ? 'User ID' : e.targetType} </span>}
                      <span className="mono">{e.targetId ?? ''}</span>
                      {e.targetType === 'USER' && typeof e.details?.name === 'string' && <div className="cell-sub">{e.details.name}</div>}
                    </td>
                    <td>
                      {e.details ? (
                        <div className="json">{expanded === e.id ? JSON.stringify(e.details, null, 2) : truncate(JSON.stringify(e.details), 90)}</div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono small">{e.clientIp ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} noun="events" onPage={setPage} />}
      </div>
    </>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
