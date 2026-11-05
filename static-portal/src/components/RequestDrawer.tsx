import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, Clock, Pause, Pencil, Play, RotateCcw, Send, X, XCircle, Zap } from 'lucide-react';
import { api, errorMessage, notifyChanged } from '../api';
import { changeLabel, fmtDateTime, mappingLabel, resultMessage, timeUntil } from '../format';
import type { ChangeRequest, Snapshot } from '../types';
import EditScheduleDialog from './EditScheduleDialog';
import RecordForm from './RecordForm';
import { useToast } from './Toast';
import { CrStatusBadge, Drawer, Loading } from './ui';

type Mode = 'none' | 'approve' | 'reject' | 'cancel' | 'confirm';

function rows(cr: ChangeRequest): { label: string; current?: string; proposed?: string }[] {
  const prev: Snapshot = cr.previous ?? {};
  const next: Snapshot = cr.proposed ?? {};
  const ptr = cr.recordType === 'PTR';
  const fmtTtl = (t?: number) => (t === undefined ? undefined : `${t} s`);
  const list = [
    { label: 'Mapping', current: prev.mappingType && mappingLabel[prev.mappingType], proposed: next.mappingType && mappingLabel[next.mappingType] },
    ptr
      ? { label: 'IP address', current: prev.ips?.[0], proposed: next.ips?.[0] }
      : { label: 'Domain', current: prev.domain, proposed: next.domain },
    ptr
      ? { label: 'Points to', current: prev.domain, proposed: next.domain }
      : { label: 'IP addresses', current: prev.ips?.join(', '), proposed: next.ips?.join(', ') },
    { label: 'TTL', current: fmtTtl(prev.ttl), proposed: fmtTtl(next.ttl) },
  ];
  if (ptr) list.splice(2, 0, { label: 'PTR name', current: prev.ptrName ?? undefined, proposed: next.ptrName ?? undefined });
  if (cr.operation === 'ROLLBACK' && prev.status === 'DELETED') list.push({ label: 'State', current: 'Deleted', proposed: 'Active (restored)' });
  return list;
}

export default function RequestDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [cr, setCr] = useState<ChangeRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('none');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<ChangeRequest>(`/api/change-requests/${id}`)
      .then(setCr)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    setCr(null);
    setMode('none');
    setComment('');
    load();
  }, [load]);

  async function act(action: 'approve' | 'reject' | 'cancel' | 'confirm') {
    if (action === 'reject' && !comment.trim()) {
      toast.error('A rejection needs a comment for the maker.');
      return;
    }
    setBusy(true);
    try {
      const body = action === 'approve' || action === 'reject' ? { comment } : {};
      const updated = await api.post<ChangeRequest>(`/api/change-requests/${id}/${action}`, body);
      setCr(updated);
      setMode('none');
      setComment('');
      if (action === 'approve' || action === 'confirm') {
        const msg = resultMessage(updated);
        toast.show(msg.kind, msg.text);
      } else {
        toast.success(`${updated.number} ${action === 'reject' ? 'rejected' : 'cancelled'}.`);
      }
      notifyChanged();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
      load();
    } finally {
      setBusy(false);
    }
  }

  const showCurrent = cr?.operation !== 'CREATE';
  const showProposed = cr?.operation !== 'DELETE';
  const timePassed = !!cr?.scheduledAt && new Date(cr.scheduledAt).getTime() <= Date.now();
  const usesRecordForm = cr?.operation === 'CREATE' || cr?.operation === 'MODIFY';

  let footer = null;
  if (cr && mode === 'none') {
    if (cr.canApprove) {
      footer = (
        <>
          <button className="btn btn-danger" onClick={() => setMode('reject')}>
            <X size={16} /> Reject
          </button>
          <button className="btn btn-success" onClick={() => setMode('approve')} disabled={timePassed} title={timePassed ? 'The scheduled time has passed' : undefined}>
            <Check size={16} /> Approve
          </button>
        </>
      );
    } else if (cr.canCancel || cr.canEdit || cr.canConfirm) {
      footer = (
        <>
          {cr.canCancel && (
            <button className="btn btn-danger" onClick={() => setMode('cancel')}>
              {cr.status === 'PENDING_APPROVAL' ? 'Cancel request' : cr.status === 'HELD' ? 'Cancel rollback' : 'Cancel scheduled change'}
            </button>
          )}
          {cr.canEdit && (
            <button className="btn" onClick={() => setEditing(true)}>
              <Pencil size={16} /> {usesRecordForm ? 'Edit request' : cr.operation === 'ROLLBACK' ? 'Edit time and reason' : 'Edit reason'}
            </button>
          )}
          {cr.canConfirm && (
            <button className="btn btn-primary" onClick={() => setMode('confirm')}>
              <Play size={16} /> Run rollback now
            </button>
          )}
        </>
      );
    }
  } else if (cr && mode !== 'none') {
    footer = (
      <div style={{ width: '100%' }}>
        {(mode === 'approve' || mode === 'reject') && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="decision-comment">{mode === 'reject' ? 'Reason for rejection (required)' : 'Comment (optional)'}</label>
            <textarea id="decision-comment" className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          </div>
        )}
        {mode === 'cancel' && <p style={{ marginBottom: 12 }}>Cancel {cr.number}? This cannot be undone.</p>}
        {mode === 'confirm' && (
          <p style={{ marginBottom: 12 }}>
            Run the rollback now? The configuration of v{cr.targetVersion} is applied over the record as it is now, and saved as a new version.
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setMode('none')} disabled={busy}>
            Back
          </button>
          {mode === 'approve' && (
            <button className="btn btn-success" onClick={() => act('approve')} disabled={busy}>
              <Check size={16} /> {busy ? 'Working…' : cr.scheduledAt ? 'Approve and schedule' : 'Approve and apply'}
            </button>
          )}
          {mode === 'reject' && (
            <button className="btn btn-danger-solid" onClick={() => act('reject')} disabled={busy}>
              {busy ? 'Rejecting…' : 'Reject request'}
            </button>
          )}
          {mode === 'cancel' && (
            <button className="btn btn-danger-solid" onClick={() => act('cancel')} disabled={busy}>
              {busy ? 'Cancelling…' : 'Yes, cancel it'}
            </button>
          )}
          {mode === 'confirm' && (
            <button className="btn btn-primary" onClick={() => act('confirm')} disabled={busy}>
              <RotateCcw size={16} /> {busy ? 'Running…' : 'Run rollback now'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentTitle =
    cr?.operation === 'DELETE' ? 'Current (to be deleted)' : `Current${cr?.baseVersion ? ` · v${cr.baseVersion}` : ''}`;
  const proposedTitle = cr?.operation === 'CREATE' ? 'New record' : cr?.operation === 'ROLLBACK' ? `Restored from v${cr.targetVersion}` : 'Proposed';

  return (
    <>
      <Drawer
        title={cr ? `${cr.number} · ${changeLabel(cr)} ${cr.recordKey}` : 'Change request'}
        subtitle={
          cr ? (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <CrStatusBadge status={cr.status} />
              {cr.direct && <span className="badge badge-navy">{cr.operation === 'ROLLBACK' ? 'Admin rollback' : 'Direct change'}</span>}
              {cr.scheduledAt && (
                <span className="badge badge-blue">
                  <CalendarClock size={12} /> {fmtDateTime(cr.scheduledAt)}
                </span>
              )}
              <span>{cr.group.name}</span>
            </span>
          ) : undefined
        }
        onClose={onClose}
        footer={footer}
      >
        {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}
        {!cr && !error && <Loading />}
        {cr && (
          <>
            {cr.status === 'FAILED' && (
              <div className="alert alert-error" style={{ marginTop: 16 }}>
                <AlertTriangle size={17} />
                <span>{cr.errorMessage}</span>
              </div>
            )}
            {cr.status === 'HELD' && (
              <div className="alert alert-warn" style={{ marginTop: 16 }}>
                <Pause size={17} />
                <span>
                  <strong>Held, not run. </strong>
                  {cr.errorMessage} {cr.canConfirm ? 'Review the record, then run the rollback now or cancel it.' : 'It waits for the Admin to run or cancel it.'}
                </span>
              </div>
            )}
            {cr.status === 'SCHEDULED' && (
              <div className="alert alert-info" style={{ marginTop: 16 }}>
                <CalendarClock size={17} />
                <span>
                  Runs on F5 at <strong>{fmtDateTime(cr.scheduledAt)}</strong> ({timeUntil(cr.scheduledAt)}). Before running, the portal re-checks that the
                  record has not changed since.
                  {cr.canEdit && !cr.direct && ' Editing it sends it back to the Checkers for re-approval.'}
                </span>
              </div>
            )}
            {cr.canApprove && mode === 'none' && (
              <div className={`alert ${timePassed ? 'alert-warn' : 'alert-info'}`} style={{ marginTop: 16 }}>
                <Clock size={17} />
                <span>
                  {timePassed
                    ? 'The scheduled time of this request has passed, so it cannot be approved as it is. The maker needs to choose a new time.'
                    : cr.scheduledAt
                      ? `This request is waiting for a Checker. Approving it schedules the change for ${fmtDateTime(cr.scheduledAt)}.`
                      : 'This request is waiting for a Checker. Approving it applies the change to F5 straight away.'}
                </span>
              </div>
            )}

            <div className="section-title">Change</div>
            <div className="card">
              <table className="table compare">
                <thead>
                  <tr>
                    <th>Field</th>
                    {showCurrent && <th>{currentTitle}</th>}
                    {showProposed && <th>{proposedTitle}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows(cr).map((row) => {
                    const changed = (cr.operation === 'MODIFY' || cr.operation === 'ROLLBACK') && row.current !== row.proposed;
                    return (
                      <tr key={row.label}>
                        <td className="label">{row.label}</td>
                        {showCurrent && <td className="mono">{row.current ?? '—'}</td>}
                        {showProposed && <td className={`mono${changed ? ' changed' : ''}`}>{row.proposed ?? '—'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="section-title">Details</div>
            <dl className="kv">
              <dt>Reason</dt>
              <dd>{cr.reason}</dd>
              <dt>ITSM reference</dt>
              <dd>{cr.itsmRef ?? '—'}</dd>
              <dt>Partition</dt>
              <dd>{cr.group.name}</dd>
              <dt>When</dt>
              <dd>{cr.scheduledAt ? `Scheduled for ${fmtDateTime(cr.scheduledAt)}` : cr.direct ? 'Immediately' : 'As soon as approved'}</dd>
              {cr.operation === 'ROLLBACK' && (
                <>
                  <dt>Restores</dt>
                  <dd>Configuration of v{cr.targetVersion}</dd>
                </>
              )}
              {cr.resultVersion && (
                <>
                  <dt>Resulting version</dt>
                  <dd>v{cr.resultVersion}</dd>
                </>
              )}
            </dl>

            <div className="section-title">Timeline</div>
            <ul className="timeline">
              <li>
                <span className="t-icon">{cr.operation === 'ROLLBACK' ? <RotateCcw size={14} /> : cr.direct ? <Zap size={14} /> : <Send size={14} />}</span>
                <div>
                  <div>
                    {cr.operation === 'ROLLBACK' ? 'Rollback by ' : cr.direct ? 'Direct change by ' : 'Raised by '}
                    <strong>{cr.maker.displayName || cr.maker.username}</strong>
                  </div>
                  <div className="small muted">{fmtDateTime(cr.createdAt)}</div>
                </div>
              </li>
              {cr.decidedAt && cr.status !== 'CANCELLED' && cr.decidedBy && (
                <li>
                  <span className={`t-icon ${cr.status === 'REJECTED' ? 'red' : 'green'}`}>
                    {cr.status === 'REJECTED' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  </span>
                  <div>
                    <div>
                      {cr.status === 'REJECTED' ? 'Rejected by ' : 'Approved by '}
                      <strong>{cr.decidedBy.displayName || cr.decidedBy.username}</strong>
                    </div>
                    <div className="small muted">{fmtDateTime(cr.decidedAt)}</div>
                    {cr.decisionComment && <div className="quote">{cr.decisionComment}</div>}
                  </div>
                </li>
              )}
              {cr.scheduledAt && (cr.status === 'SCHEDULED' || cr.status === 'HELD' || cr.executedAt) && (
                <li>
                  <span className="t-icon blue">
                    <CalendarClock size={14} />
                  </span>
                  <div>
                    <div>Scheduled for {fmtDateTime(cr.scheduledAt)}</div>
                    {cr.status === 'SCHEDULED' && <div className="small muted">{timeUntil(cr.scheduledAt)}</div>}
                  </div>
                </li>
              )}
              {cr.status === 'CANCELLED' && (
                <li>
                  <span className="t-icon">
                    <X size={14} />
                  </span>
                  <div>
                    <div>Cancelled by the maker</div>
                    <div className="small muted">{fmtDateTime(cr.decidedAt)}</div>
                  </div>
                </li>
              )}
              {cr.status === 'HELD' && (
                <li>
                  <span className="t-icon amber">
                    <Pause size={14} />
                  </span>
                  <div>
                    <div>Held for the Admin to confirm</div>
                    <div className="small muted">{fmtDateTime(cr.updatedAt)}</div>
                  </div>
                </li>
              )}
              {cr.executedAt && (
                <li>
                  <span className={`t-icon ${cr.status === 'FAILED' ? 'red' : 'green'}`}>
                    {cr.status === 'FAILED' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  </span>
                  <div>
                    <div>{cr.status === 'FAILED' ? 'Execution failed' : 'Applied to F5'}</div>
                    <div className="small muted">{fmtDateTime(cr.executedAt)}</div>
                  </div>
                </li>
              )}
              {cr.status === 'PENDING_APPROVAL' && (
                <li>
                  <span className="t-icon amber">
                    <Clock size={14} />
                  </span>
                  <div>
                    <div>Waiting for a Checker or the Admin</div>
                  </div>
                </li>
              )}
            </ul>

            {cr.executionResult && cr.executionResult.length > 0 && (
              <>
                <div className="section-title">F5 result per site</div>
                <div className="card">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Site</th>
                        <th>Result</th>
                        <th>Code</th>
                        <th>Message from F5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cr.executionResult.map((s) => (
                        <tr key={s.site}>
                          <td>
                            <strong>{s.site}</strong>
                          </td>
                          <td>{s.success ? <span className="badge badge-green">OK</span> : <span className="badge badge-red">Error</span>}</td>
                          <td className="mono">{s.code ?? '—'}</td>
                          <td className="small" style={{ overflowWrap: 'anywhere' }}>{s.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </Drawer>
      {editing && cr && usesRecordForm && (
        <RecordForm
          mode={{ kind: 'editRequest', request: cr }}
          groups={[cr.group]}
          onClose={() => setEditing(false)}
          onDone={(updated) => {
            setEditing(false);
            setCr(updated);
            const msg = resultMessage(updated);
            toast.show(msg.kind, `Saved. ${msg.text}`);
            notifyChanged();
            onChanged();
          }}
        />
      )}
      {editing && cr && !usesRecordForm && (
        <EditScheduleDialog
          request={cr}
          onClose={() => setEditing(false)}
          onDone={(updated) => {
            setEditing(false);
            setCr(updated);
            const msg = resultMessage(updated);
            toast.show(msg.kind, `Saved. ${msg.text}`);
            notifyChanged();
            onChanged();
          }}
        />
      )}
    </>
  );
}
