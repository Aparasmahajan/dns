import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, Clock, Pencil, Plus, Search, SearchX, Trash2 } from 'lucide-react';
import { api, errorMessage, notifyChanged } from '../api';
import { useMe } from '../auth';
import DeleteRecordDialog from '../components/DeleteRecordDialog';
import RecordDrawer from '../components/RecordDrawer';
import RecordForm, { type RecordFormMode } from '../components/RecordForm';
import { useToast } from '../components/Toast';
import { Empty, Loading, MappingTag, Pager } from '../components/ui';
import { canWrite, fmtDateTime, resultMessage, timeAgo } from '../format';
import type { ChangeRequest, DnsRecord, Group, Page } from '../types';

export default function RecordsPage() {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const groupId = params.get('groupId') ?? '';
  const type = params.get('type') ?? '';
  const status = params.get('status') === 'DELETED' ? 'DELETED' : '';
  const page = Number(params.get('page') ?? '0');

  const [search, setSearch] = useState(q);
  const [groups, setGroups] = useState<Group[]>([]);
  const [data, setData] = useState<Page<DnsRecord> | null>(null);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState<RecordFormMode | null>(params.get('new') === '1' ? { kind: 'create' } : null);
  const [deleting, setDeleting] = useState<DnsRecord | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const update = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params);
      Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      if (!('page' in changes)) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => setSearch(q), [q]);

  // Debounced search box
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (search.trim() !== q) update({ q: search.trim() });
    }, 350);
    return () => window.clearTimeout(t);
  }, [search, q, update]);

  useEffect(() => {
    if (params.get('new') === '1') {
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    api.get<Group[]>('/api/groups').then(setGroups).catch(() => setGroups([]));
  }, [reload]);

  useEffect(() => {
    let alive = true;
    setData(null);
    const query = new URLSearchParams({ page: String(page), size: '25' });
    if (q) query.set('q', q);
    if (groupId) query.set('groupId', groupId);
    if (type) query.set('type', type);
    if (status) query.set('status', status);
    api
      .get<Page<DnsRecord>>(`/api/records?${query}`)
      .then((d) => alive && setData(d))
      .catch((e) => {
        toast.error(errorMessage(e));
        if (alive) setData({ content: [], page: 0, size: 25, totalElements: 0, totalPages: 0 });
      });
    return () => {
      alive = false;
    };
  }, [q, groupId, type, status, page, reload, toast]);

  function handleDone(cr: ChangeRequest) {
    setForm(null);
    setDeleting(null);
    setOpenId(null);
    const msg = resultMessage(cr);
    toast.show(msg.kind, msg.text);
    notifyChanged();
    setReload((x) => x + 1);
    if (cr.status === 'FAILED' || cr.status === 'HELD') navigate(`/requests?tab=mine&id=${cr.id}`);
  }

  const writable = canWrite(me);
  const writableGroups = me.allGroups ? groups : groups.filter((g) => me.groups.some((m) => m.id === g.id));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">DNS</div>
          <h1>DNS Records</h1>
          <div className="sub">
            {me.allGroups ? 'Records in all partitions' : `Records in your partitions: ${me.groups.map((g) => g.name).join(', ') || 'none assigned'}`}
          </div>
        </div>
        {writable && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setForm({ kind: 'create' })} style={{ height: 42 }}>
              <Plus size={17} /> New DNS record
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input className="input" placeholder="Search domain or IP" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
          </div>
          <select className="select" value={groupId} onChange={(e) => update({ groupId: e.target.value })} aria-label="Filter by partition">
            <option value="">All my partitions</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select className="select" value={type} onChange={(e) => update({ type: e.target.value })} aria-label="Filter by mapping type">
            <option value="">All mapping types</option>
            <option value="SINGLE">One-to-one (A)</option>
            <option value="MULTI">One-to-many (A)</option>
            <option value="PTR">PTR (reverse)</option>
          </select>
          <select className="select" value={status} onChange={(e) => update({ status: e.target.value })} aria-label="Active or deleted records">
            <option value="">Active records</option>
            <option value="DELETED">Deleted records</option>
          </select>
        </div>

        {!data ? (
          <Loading />
        ) : data.content.length === 0 ? (
          status ? (
            <Empty title="No deleted records" icon={<SearchX size={34} />}>
              Deleted records keep their version history and can be restored by the Admin.
            </Empty>
          ) : q || groupId || type ? (
            <Empty title="No records match these filters" icon={<SearchX size={34} />} />
          ) : (
            <Empty title="No DNS records yet">{writable ? 'Use “New DNS record” to add the first one.' : 'Records will appear here once they are added.'}</Empty>
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name / IP</th>
                  <th>Type</th>
                  <th>Points to</th>
                  <th>TTL</th>
                  <th>Partition</th>
                  <th>Version</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.content.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                    <td>
                      <div className="cell-main mono">{r.key}</div>
                      {r.ptrName && <div className="cell-sub mono">{r.ptrName}</div>}
                    </td>
                    <td>
                      <MappingTag type={r.mappingType} />
                    </td>
                    <td>
                      {r.recordType === 'PTR' ? (
                        <span className="mono">{r.domain}</span>
                      ) : (
                        <div className="ip-list">
                          {r.ips.map((ip) => (
                            <span key={ip} className="ip-chip">
                              {ip}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="mono">{r.ttl}</td>
                    <td>{r.group.name}</td>
                    <td className="nowrap">
                      v{r.version}
                      {r.status === 'DELETED' && <span className="badge badge-red" style={{ marginLeft: 6 }}>Deleted</span>}
                    </td>
                    <td className="muted nowrap">{timeAgo(r.updatedAt)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {r.scheduled && !r.pending && (
                        <span
                          className={`badge ${r.scheduled.status === 'HELD' ? 'badge-amber' : 'badge-blue'}`}
                          title={r.scheduled.status === 'HELD' ? `${r.scheduled.number} is held for the Admin` : `${r.scheduled.number} runs ${fmtDateTime(r.scheduled.scheduledAt)}`}
                          style={{ marginRight: 4 }}
                        >
                          <CalendarClock size={12} /> {r.scheduled.number}
                        </span>
                      )}
                      {r.pending ? (
                        <span className="badge badge-amber" title={`${r.pending.number} is pending`}>
                          <Clock size={12} /> {r.pending.number}
                        </span>
                      ) : r.canChange ? (
                        <>
                          <button className="btn btn-ghost btn-icon" title="Modify" aria-label={`Modify ${r.key}`} onClick={() => setForm({ kind: 'modify', record: r })}>
                            <Pencil size={16} />
                          </button>
                          <button className="btn btn-ghost btn-icon" title="Delete" aria-label={`Delete ${r.key}`} onClick={() => setDeleting(r)}>
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <Pager page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} noun="records" onPage={(p) => update({ page: String(p) })} />
        )}
      </div>

      {openId !== null && (
        <RecordDrawer
          recordId={openId}
          onClose={() => setOpenId(null)}
          onModify={(r) => {
            setOpenId(null);
            setForm({ kind: 'modify', record: r });
          }}
          onDelete={(r) => {
            setOpenId(null);
            setDeleting(r);
          }}
          onRolledBack={handleDone}
        />
      )}
      {form && <RecordForm mode={form} groups={writableGroups} onClose={() => setForm(null)} onDone={handleDone} />}
      {deleting && <DeleteRecordDialog record={deleting} onClose={() => setDeleting(null)} onDone={handleDone} />}
    </>
  );
}
