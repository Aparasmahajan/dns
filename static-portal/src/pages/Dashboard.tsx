import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { useToast } from '../components/Toast';
import { CrStatusBadge, Empty, Loading } from '../components/ui';
import { canWrite, changeLabel, isAdmin, isChecker, timeAgo } from '../format';
import type { Dashboard as DashboardData, HealthItem } from '../types';

const PERIODS = [7, 30, 90];

function healthBadge(h: HealthItem) {
  switch (h.status) {
    case 'UP':
      return <span className="badge badge-green">Connected</span>;
    case 'DOWN':
      return <span className="badge badge-red">Down</span>;
    case 'MOCK':
      return <span className="badge badge-amber">Mock mode</span>;
    case 'DISABLED':
      return <span className="badge badge-grey">Disabled</span>;
    case 'RUNNING':
      return <span className="badge badge-green">Running</span>;
    case 'STANDBY':
      return <span className="badge badge-grey">Standby</span>;
    default:
      return <span className="badge badge-blue">Configured</span>;
  }
}

export default function Dashboard() {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<DashboardData>(`/api/dashboard?days=${days}`)
      .then((d) => alive && setData(d))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [days, toast]);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const scope = me.allGroups ? 'Showing all partitions' : `Showing your partitions: ${me.groups.map((g) => g.name).join(', ') || 'none assigned'}`;
  const maxGroup = Math.max(1, ...(data?.perGroup.map((g) => g.count) ?? [1]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Home</div>
          <h1>Dashboard</h1>
          <div className="sub">
            {today} · {scope}
          </div>
        </div>
        <div className="page-actions">
          <div className="segmented" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} className={days === p ? 'active' : ''} onClick={() => setDays(p)}>
                {p} days
              </button>
            ))}
          </div>
          {canWrite(me) && (
            <button className="btn btn-primary" onClick={() => navigate('/records?new=1')} style={{ height: 42 }}>
              <Plus size={17} /> New DNS record
            </button>
          )}
        </div>
      </div>

      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid-4">
            <div className="card kpi">
              <div className="k-label">Total DNS records</div>
              <div className="k-value">{data.totalRecords.toLocaleString('en-IN')}</div>
              <div className="k-foot">
                +{data.addedInPeriod} in the last {data.days} days
              </div>
            </div>
            {isChecker(me) ? (
              <Link to="/requests?tab=approvals" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="k-label">Awaiting your approval</div>
                <div className={`k-value${data.awaitingApproval ? ' amber' : ''}`}>{data.awaitingApproval ?? 0}</div>
                <div className="k-foot">Raised by Write users</div>
              </Link>
            ) : (
              <Link to="/requests?tab=mine" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="k-label">Your pending requests</div>
                <div className={`k-value${data.myPending ? ' amber' : ''}`}>{data.myPending}</div>
                <div className="k-foot">{canWrite(me) ? 'Waiting for a Checker' : 'Read-only access'}</div>
              </Link>
            )}
            <div className="card kpi">
              <div className="k-label">Changes applied</div>
              <div className="k-value">{data.appliedInPeriod}</div>
              <div className="k-foot">
                {data.days} days · {data.failedInPeriod} failed ·{' '}
                <Link to="/requests?tab=scheduled">
                  {data.scheduled} scheduled{data.held ? `, ${data.held} held` : ''}
                </Link>
              </div>
            </div>
            {isAdmin(me) ? (
              <Link to="/users" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="k-label">Users waiting for access</div>
                <div className={`k-value${data.pendingUsers ? ' amber' : ''}`}>{data.pendingUsers ?? 0}</div>
                <div className="k-foot">Access requests from Bank users</div>
              </Link>
            ) : (
              <div className="card kpi">
                <div className="k-label">Partitions</div>
                <div className="k-value">{data.groupCount}</div>
                <div className="k-foot">{me.allGroups ? 'All partitions visible to you' : 'Assigned to you'}</div>
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <h3>Records per partition</h3>
                <Link to="/records" className="right">
                  Open records
                </Link>
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {data.perGroup.length === 0 ? (
                  <Empty title="No partitions yet">{isAdmin(me) ? 'Create partitions under Partitions.' : 'Ask the Admin to create partitions.'}</Empty>
                ) : (
                  data.perGroup.map((g) => (
                    <div className="bar-row" key={g.id}>
                      <Link to={`/records?groupId=${g.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {g.name}
                      </Link>
                      <div className="bar">
                        <span style={{ width: `${Math.max(2, (g.count / maxGroup) * 100)}%` }} />
                      </div>
                      <div className="num">{g.count.toLocaleString('en-IN')}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Platform health</h3>
                {data.health.every((h) => h.status !== 'DOWN') ? (
                  <span className="badge badge-green right">No outages</span>
                ) : (
                  <span className="badge badge-red right">Attention needed</span>
                )}
              </div>
              <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                {data.health.map((h) => (
                  <div className="health-row" key={h.name}>
                    <div>
                      <div className="h-name">{h.name}</div>
                      <div className="h-detail">{h.detail}</div>
                    </div>
                    {healthBadge(h)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Recent change requests</h3>
              <Link to="/requests?tab=all" className="right">
                View all
              </Link>
            </div>
            {data.recent.length === 0 ? (
              <Empty title="No change requests yet" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Change</th>
                      <th>Partition</th>
                      <th>Maker</th>
                      <th>Status</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((cr) => (
                      <tr key={cr.id} className="clickable" onClick={() => navigate(`/requests?tab=all&id=${cr.id}`)}>
                        <td className="mono nowrap">{cr.number}</td>
                        <td>
                          <span className="cell-main">{changeLabel(cr)}</span> <span className="mono">{cr.recordKey}</span>
                          {cr.direct && <span className="badge badge-navy" style={{ marginLeft: 8 }}>Direct</span>}
                        </td>
                        <td>{cr.group.name}</td>
                        <td>{cr.maker.displayName || cr.maker.username}</td>
                        <td>
                          <CrStatusBadge status={cr.status} />
                        </td>
                        <td className="muted nowrap">{timeAgo(cr.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
