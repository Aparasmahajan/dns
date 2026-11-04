import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Clock, GitCompare, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { changeLabel, fmtDateTime, mappingLabel, operationLabel, timeUntil } from '../format';
import type { ChangeRequest, DnsRecord, RecordDetail, RecordVersion } from '../types';
import CompareTable from './CompareTable';
import RollbackDialog from './RollbackDialog';
import { Drawer, Loading, MappingTag } from './ui';

/** Versions are major.minor with a single minor digit, so they sort as numbers. */
const order = (v: string) => Number(v);

function versionNote(v: RecordVersion): string | null {
  if (v.operation === 'ROLLBACK' && v.restoredFrom) return `Rollback to v${v.restoredFrom}`;
  if (v.deleted || !v.operation) return null;
  return operationLabel[v.operation];
}

export default function RecordDrawer({
  recordId,
  onClose,
  onModify,
  onDelete,
  onRolledBack,
}: {
  recordId: number;
  onClose: () => void;
  onModify: (r: DnsRecord) => void;
  onDelete: (r: DnsRecord) => void;
  onRolledBack: (cr: ChangeRequest) => void;
}) {
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [rollbackTo, setRollbackTo] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setPicked([]);
    api
      .get<RecordDetail>(`/api/records/${recordId}`)
      .then(setDetail)
      .catch((e) => setError(errorMessage(e)));
  }, [recordId]);

  const r = detail?.record;
  const admin = !!r?.canRollback;
  const deleted = r?.status === 'DELETED';

  const comparison = useMemo(() => {
    if (!detail || picked.length !== 2) return null;
    const [a, b] = [...picked].sort((x, y) => order(x) - order(y));
    const older = detail.versions.find((v) => v.version === a);
    const newer = detail.versions.find((v) => v.version === b);
    return older && newer ? { older, newer } : null;
  }, [detail, picked]);

  function toggle(version: string) {
    setPicked((p) => (p.includes(version) ? p.filter((v) => v !== version) : [...p.slice(-1), version]));
  }

  /** A version can be restored if it holds a configuration and is not what the record already is. */
  const canRestore = (v: RecordVersion) => admin && !v.deleted && r !== undefined && v.version !== r.version;

  return (
    <>
      <Drawer
        title={r ? <span className="mono">{r.key}</span> : 'DNS record'}
        subtitle={
          r ? (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <MappingTag type={r.mappingType} /> v{r.version} · {r.group.name}
              {deleted && <span className="badge badge-red">Deleted</span>}
            </span>
          ) : undefined
        }
        onClose={onClose}
        footer={
          r?.canChange ? (
            <>
              <button className="btn btn-danger" onClick={() => onDelete(r)}>
                <Trash2 size={16} /> Delete
              </button>
              <button className="btn btn-primary" onClick={() => onModify(r)}>
                <Pencil size={16} /> Modify
              </button>
            </>
          ) : undefined
        }
      >
        {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}
        {!detail && !error && <Loading />}
        {r && detail && (
          <>
            {deleted && (
              <div className="alert alert-info" style={{ marginTop: 16 }}>
                <RotateCcw size={17} />
                <span>
                  This record was deleted in v{r.version}. Its history is kept.{' '}
                  {admin ? 'You can restore it by rolling back to an earlier version below.' : 'The Admin can restore it by rolling back to an earlier version.'}
                </span>
              </div>
            )}
            {r.pending && (
              <div className="alert alert-warn" style={{ marginTop: 16 }}>
                <Clock size={17} />
                <span>
                  {operationLabel[r.pending.operation]} request{' '}
                  <Link to={`/requests?tab=all&id=${r.pending.id}`}>{r.pending.number}</Link> is waiting for approval. The record
                  cannot be changed until it is decided.
                </span>
              </div>
            )}
            {r.scheduled && (
              <div className={`alert ${r.scheduled.status === 'HELD' ? 'alert-warn' : 'alert-info'}`} style={{ marginTop: 16 }}>
                <CalendarClock size={17} />
                <span>
                  {changeLabel({ operation: r.scheduled.operation, targetVersion: null })}{' '}
                  <Link to={`/requests?tab=scheduled&id=${r.scheduled.id}`}>{r.scheduled.number}</Link>{' '}
                  {r.scheduled.status === 'HELD'
                    ? 'is held: the record changed after it was scheduled, so it waits for the Admin.'
                    : `is scheduled for ${fmtDateTime(r.scheduled.scheduledAt)} (${timeUntil(r.scheduled.scheduledAt)}).`}
                </span>
              </div>
            )}

            <div className="section-title">{deleted ? 'Last configuration' : 'Configuration'}</div>
            <dl className="kv">
              <dt>Mapping</dt>
              <dd>{mappingLabel[r.mappingType]}</dd>
              {r.recordType === 'PTR' ? (
                <>
                  <dt>IP address</dt>
                  <dd className="mono">{r.key}</dd>
                  <dt>Points to</dt>
                  <dd className="mono">{r.domain}</dd>
                  <dt>PTR name</dt>
                  <dd className="mono">{r.ptrName}</dd>
                </>
              ) : (
                <>
                  <dt>Domain</dt>
                  <dd className="mono">{r.domain}</dd>
                  <dt>IP address{r.ips.length > 1 ? 'es' : ''}</dt>
                  <dd>
                    <div className="ip-list">
                      {r.ips.map((ip) => (
                        <span key={ip} className="ip-chip">
                          {ip}
                        </span>
                      ))}
                    </div>
                  </dd>
                </>
              )}
              <dt>TTL</dt>
              <dd>{r.ttl} seconds</dd>
              <dt>Partition</dt>
              <dd>{r.group.name}</dd>
              <dt>Version</dt>
              <dd>v{r.version}</dd>
              <dt>Created</dt>
              <dd>
                {fmtDateTime(r.createdAt)} · {r.createdBy}
              </dd>
              <dt>Last change</dt>
              <dd>
                {fmtDateTime(r.updatedAt)} · {r.updatedBy}
              </dd>
            </dl>

            <div className="section-title">Version history</div>
            {admin && (
              <p className="hint" style={{ margin: '-4px 0 10px' }}>
                Tick two versions to compare them. Use <RotateCcw size={12} style={{ verticalAlign: '-1px' }} /> to roll the record back to a version.
              </p>
            )}

            {comparison && (
              <div style={{ marginBottom: 14 }}>
                <div className="compare-head">
                  <GitCompare size={16} />
                  <strong>
                    v{comparison.older.version} → v{comparison.newer.version}
                  </strong>
                  <button className="btn btn-ghost btn-sm right" onClick={() => setPicked([])}>
                    <X size={14} /> Close comparison
                  </button>
                </div>
                <CompareTable
                  left={comparison.older.snapshot}
                  right={comparison.newer.snapshot}
                  leftTitle={<span className="ver">v{comparison.older.version}</span>}
                  rightTitle={<span className="ver">v{comparison.newer.version}</span>}
                  recordType={r.recordType}
                />
              </div>
            )}

            <div className="card">
              <table className="table versions">
                <thead>
                  <tr>
                    {admin && <th className="pick" aria-label="Compare" />}
                    <th>Version</th>
                    <th>Configuration</th>
                    <th>Changed</th>
                    {admin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {detail.versions.map((v) => (
                    <tr key={v.version} className={picked.includes(v.version) ? 'selected' : undefined}>
                      {admin && (
                        <td className="pick">
                          <input
                            type="checkbox"
                            className="check-input"
                            checked={picked.includes(v.version)}
                            onChange={() => toggle(v.version)}
                            aria-label={`Compare v${v.version}`}
                          />
                        </td>
                      )}
                      <td className="nowrap">
                        <strong>v{v.version}</strong>
                        {v.version === r.version && !deleted && <span className="badge badge-green" style={{ marginLeft: 6 }}>Current</span>}
                        {v.deleted && <span className="badge badge-red" style={{ marginLeft: 6 }}>Deleted</span>}
                        {versionNote(v) && <div className="small muted">{versionNote(v)}</div>}
                      </td>
                      <td className="small">
                        <div className="mono">{r.recordType === 'PTR' ? `→ ${v.snapshot.domain}` : (v.snapshot.ips ?? []).join(', ')}</div>
                        <div className="muted">TTL {v.snapshot.ttl} s</div>
                      </td>
                      <td className="small">
                        <div className="nowrap">{fmtDateTime(v.createdAt)}</div>
                        <div className="muted nowrap">
                          {v.createdBy}
                          {v.changeRequestId && (
                            <>
                              {' · '}
                              <Link to={`/requests?tab=all&id=${v.changeRequestId}`} className="mono">
                                {v.changeRequestNumber}
                              </Link>
                            </>
                          )}
                        </div>
                      </td>
                      {admin && (
                        <td className="v-actions">
                          {canRestore(v) && (
                            <button
                              className="btn btn-ghost btn-icon"
                              title={`Roll back to v${v.version}`}
                              aria-label={`Roll back to v${v.version}`}
                              onClick={() => setRollbackTo(v.version)}
                            >
                              <RotateCcw size={16} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Drawer>
      {rollbackTo && r && (
        <RollbackDialog
          record={r}
          toVersion={rollbackTo}
          onClose={() => setRollbackTo(null)}
          onDone={(cr) => {
            setRollbackTo(null);
            onRolledBack(cr);
          }}
        />
      )}
    </>
  );
}
