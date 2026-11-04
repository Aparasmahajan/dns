import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, RotateCcw } from 'lucide-react';
import { api, errorMessage } from '../api';
import type { ChangeRequest, DnsRecord, RollbackPreview } from '../types';
import CompareTable from './CompareTable';
import ScheduleField, { scheduleError, scheduleIso, type ScheduleValue } from './ScheduleField';
import { Loading, Modal } from './ui';

/** Admin only: review current vs. target version, check F5, then roll back now or at a scheduled time. */
export default function RollbackDialog({
  record,
  toVersion,
  onClose,
  onDone,
}: {
  record: DnsRecord;
  toVersion: string;
  onClose: () => void;
  onDone: (cr: ChangeRequest) => void;
}) {
  const [preview, setPreview] = useState<RollbackPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleValue>({ mode: 'now', at: '' });
  const [reason, setReason] = useState('');
  const [itsmRef, setItsmRef] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RollbackPreview>(`/api/admin/records/${record.id}/rollback-preview?toVersion=${encodeURIComponent(toVersion)}`)
      .then(setPreview)
      .catch((e) => setLoadError(errorMessage(e)));
  }, [record.id, toVersion]);

  const scheduleProblem = scheduleError(schedule);
  const reasonProblem = reason.trim() ? null : 'Give a reason for the rollback.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (scheduleProblem || reasonProblem || preview?.blocker) return;
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api.post<ChangeRequest>(`/api/admin/records/${record.id}/rollback`, {
          toVersion,
          reason,
          itsmRef,
          scheduledAt: scheduleIso(schedule),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const later = schedule.mode === 'later';

  return (
    <Modal
      title={`Roll back ${record.key} to v${toVersion}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rollback-form" className="btn btn-primary" disabled={busy || !preview || !!preview.blocker}>
            <RotateCcw size={16} /> {busy ? 'Working…' : later ? 'Schedule rollback' : 'Roll back now'}
          </button>
        </>
      }
    >
      {loadError && (
        <div className="alert alert-error">
          <AlertTriangle size={17} /> <span>{loadError}</span>
        </div>
      )}
      {!preview && !loadError && <Loading />}
      {preview && (
        <form id="rollback-form" onSubmit={submit} noValidate>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16 }} role="alert">
              <AlertTriangle size={17} /> <span>{error}</span>
            </div>
          )}
          {preview.blocker && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <AlertTriangle size={17} /> <span>{preview.blocker}</span>
            </div>
          )}

          <div className="compare-head">
            <span className="result-arrow">
              v{preview.currentVersion} <ArrowRight size={15} /> v{preview.resultVersion}
            </span>
            <span className="muted small">
              The configuration of v{preview.targetVersion} is restored as a new version, v{preview.resultVersion}. History is never overwritten.
            </span>
          </div>
          <CompareTable
            left={preview.current}
            right={preview.target}
            leftTitle={
              <>
                Current · <span className="ver">v{preview.currentVersion}</span>
                {preview.recordStatus === 'DELETED' && ' (deleted)'}
              </>
            }
            rightTitle={
              <>
                After rollback · <span className="ver">from v{preview.targetVersion}</span>
              </>
            }
            recordType={record.recordType}
          />

          <div className="section-title">Live F5 check</div>
          <div
            className={`alert ${preview.live.status === 'DRIFT' ? 'alert-warn' : preview.live.status === 'MATCH' ? 'alert-success' : 'alert-info'}`}
            style={{ marginBottom: 16 }}
          >
            {preview.live.status === 'MATCH' ? <CheckCircle2 size={17} /> : preview.live.status === 'DRIFT' ? <AlertTriangle size={17} /> : <Info size={17} />}
            <span>
              {preview.live.status === 'DRIFT' && <strong>F5 differs from the portal. </strong>}
              {preview.live.message}
            </span>
          </div>

          <ScheduleField
            value={schedule}
            onChange={setSchedule}
            error={tried ? scheduleProblem : null}
            nowTitle="Roll back now"
            nowDesc="Validated and applied to F5 straight away"
            laterDesc="Held as a scheduled job and run at the time you choose"
          />

          <div className="row">
            <div className="field">
              <label htmlFor="rb-itsm">ITSM reference (optional)</label>
              <input id="rb-itsm" className="input" placeholder="CHG0012345" value={itsmRef} onChange={(e) => setItsmRef(e.target.value)} />
            </div>
            <div className="field" />
          </div>
          <div className="field">
            <label htmlFor="rb-reason">Reason for rollback</label>
            <textarea
              id="rb-reason"
              className={`textarea${tried && reasonProblem ? ' invalid' : ''}`}
              placeholder="e.g. Revert the TTL change that caused resolver load"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {tried && reasonProblem && <span className="error-text">{reasonProblem}</span>}
          </div>

          <div className="alert alert-warn">
            <Info size={17} />
            <span>
              {later
                ? 'At the scheduled time the portal re-checks the record and F5 before applying. If the record has changed in the meantime, the rollback is held for you to confirm instead of running.'
                : 'As the Admin, your rollback runs without a separate approval. It is recorded in the audit trail and forwarded to the SIEM.'}
            </span>
          </div>
        </form>
      )}
    </Modal>
  );
}
