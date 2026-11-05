import { useState, type FormEvent } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { api, errorMessage } from '../api';
import { changeLabel } from '../format';
import type { ChangeRequest } from '../types';
import ScheduleField, { scheduleError, scheduleFrom, scheduleIso, type ScheduleValue } from './ScheduleField';
import { Modal } from './ui';

/** Edit a delete request (reason, ITSM) or a rollback (also its time): these have no record form.
 *  Only updates and rollbacks can be scheduled, so a delete has no time to edit. */
export default function EditScheduleDialog({
  request,
  onClose,
  onDone,
}: {
  request: ChangeRequest;
  onClose: () => void;
  onDone: (cr: ChangeRequest) => void;
}) {
  const [schedule, setSchedule] = useState<ScheduleValue>(() => scheduleFrom(request.scheduledAt));
  const [reason, setReason] = useState(request.reason);
  const [itsmRef, setItsmRef] = useState(request.itsmRef ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSchedule = request.operation === 'ROLLBACK';
  const scheduleProblem = canSchedule ? scheduleError(schedule) : null;
  const reasonProblem = reason.trim() ? null : 'Give a reason for this change.';
  const backToApproval = !request.direct && request.status === 'SCHEDULED';
  const runsNow = canSchedule && request.direct && schedule.mode === 'now';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (scheduleProblem || reasonProblem) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.put<ChangeRequest>(`/api/change-requests/${request.id}`, { reason, itsmRef, scheduledAt: canSchedule ? scheduleIso(schedule) : null }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${request.number} · ${changeLabel(request)} ${request.recordKey}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="schedule-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : runsNow ? 'Save and run now' : 'Save'}
          </button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }} role="alert">
            <AlertTriangle size={17} /> <span>{error}</span>
          </div>
        )}
        {backToApproval && (
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <Info size={17} />
            <span>This request is already approved. Saving a change sends it back to the Checkers for re-approval.</span>
          </div>
        )}
        {canSchedule && (
        <ScheduleField
          value={schedule}
          onChange={setSchedule}
          error={tried ? scheduleProblem : null}
          nowTitle={request.direct ? 'Run now' : 'As soon as approved'}
          nowDesc={request.direct ? 'Applied to F5 when you save' : 'Runs on F5 when a Checker approves it'}
          laterDesc="Runs at the date and time you choose"
        />
        )}
        <div className="field">
          <label htmlFor="es-itsm">ITSM reference (optional)</label>
          <input id="es-itsm" className="input" value={itsmRef} onChange={(e) => setItsmRef(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="es-reason">Reason</label>
          <textarea id="es-reason" className={`textarea${tried && reasonProblem ? ' invalid' : ''}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          {tried && reasonProblem && <span className="error-text">{reasonProblem}</span>}
        </div>
      </form>
    </Modal>
  );
}
