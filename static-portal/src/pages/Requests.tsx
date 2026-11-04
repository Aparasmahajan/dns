import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import RequestDrawer from '../components/RequestDrawer';
import { useToast } from '../components/Toast';
import { CrStatusBadge, Empty, Loading, Pager } from '../components/ui';
import { canWrite, changeLabel, fmtDateTime, isChecker, statusLabel, timeAgo, timeUntil } from '../format';
import type { ChangeRequest, CrStatus, Page } from '../types';

type Tab = 'approvals' | 'mine' | 'scheduled' | 'all';

export default function RequestsPage() {
  const me = useMe();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const checker = isChecker(me);
  const defaultTab: Tab = checker ? 'approvals' : canWrite(me) ? 'mine' : 'all';
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && (requested !== 'approvals' || checker) ? requested : defaultTab;
  const openId = params.get('id');

  const [status, setStatus] = useState<CrStatus | ''>('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<ChangeRequest> | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    const query = new URLSearchParams({ scope: tab, page: String(page), size: '25' });
    if (status && tab !== 'approvals' && tab !== 'scheduled') query.set('status', status);
    api
      .get<Page<ChangeRequest>>(`/api/change-requests?${query}`)
      .then((d) => alive && setData(d))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [tab, status, page, reload, toast]);

  function setTab(next: Tab) {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    p.delete('id');
    setParams(p);
    setPage(0);
  }

  function openRequest(id: number | null) {
    const p = new URLSearchParams(params);
    if (id === null) p.delete('id');
    else p.set('id', String(id));
    setParams(p);
  }

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'approvals', label: 'Awaiting my approval', show: checker },
    { key: 'mine', label: 'My requests', show: canWrite(me) },
    { key: 'scheduled', label: 'Scheduled', show: true },
    { key: 'all', label: me.allGroups ? 'All requests' : 'All in my partitions', show: true },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">DNS</div>
          <h1>Change Requests</h1>
          <div className="sub">
            {checker
              ? 'Requests raised by Write users wait here for you. Your own changes are applied directly, now or at a scheduled time.'
              : canWrite(me)
                ? 'Your changes go to the Checkers for approval before they reach F5.'
                : 'Read-only view of DNS change requests.'}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="tabs" role="tablist">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === 'approvals' && tab === 'approvals' && data && data.totalElements > 0 && <span className="count-pill">{data.totalElements}</span>}
              </button>
            ))}
        </div>
        {tab !== 'approvals' && tab !== 'scheduled' && (
          <div className="toolbar">
            <select
              className="select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as CrStatus | '');
                setPage(0);
              }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {(Object.keys(statusLabel) as CrStatus[]).map((s) => (
                <option key={s} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </select>
          </div>
        )}

        {!data ? (
          <Loading />
        ) : data.content.length === 0 ? (
          <Empty
            title={tab === 'approvals' ? 'Nothing waiting for your approval' : tab === 'scheduled' ? 'No scheduled changes' : 'No change requests'}
            icon={<ClipboardCheck size={34} />}
          />
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
                  <th>Scheduled for</th>
                  <th>Submitted</th>
                  <th>Decided by</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((cr) => (
                  <tr key={cr.id} className="clickable" onClick={() => openRequest(cr.id)}>
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
                    <td className="nowrap small">
                      {cr.scheduledAt ? (
                        <>
                          {fmtDateTime(cr.scheduledAt)}
                          {cr.status === 'SCHEDULED' && <div className="muted">{timeUntil(cr.scheduledAt)}</div>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted nowrap">{timeAgo(cr.createdAt)}</td>
                    <td className="muted">{cr.decidedBy ? cr.decidedBy.displayName || cr.decidedBy.username : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} noun="requests" onPage={setPage} />}
      </div>

      {openId && <RequestDrawer id={Number(openId)} onClose={() => openRequest(null)} onChanged={() => setReload((x) => x + 1)} />}
    </>
  );
}
