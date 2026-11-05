import { useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { isChecker } from '../format';
import type { ChangeRequest, DnsRecord } from '../types';
import { Modal } from './ui';

export default function DeleteRecordDialog({
  record,
  onClose,
  onDone,
}: {
  record: DnsRecord;
  onClose: () => void;
  onDone: (cr: ChangeRequest) => void;
}) {
  const me = useMe();
  const direct = isChecker(me);
  const [reason, setReason] = useState('');
  const [itsmRef, setItsmRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Give a reason for deleting this record.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api.post<ChangeRequest>('/api/change-requests', { operation: 'DELETE', recordId: record.id, reason, itsmRef }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Delete ${record.key}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="delete-form" className="btn btn-danger-solid" disabled={busy}>
            {busy ? 'Working…' : direct ? 'Delete record' : 'Request deletion'}
          </button>
        </>
      }
    >
      <form id="delete-form" onSubmit={submit} noValidate>
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={17} />
          <span>
            {direct
              ? 'You are a Checker: the record is removed from F5 straight away. The last version is kept, so the Admin can restore it.'
              : 'This sends a delete request to the Checkers. The record stays live until the request is approved.'}
          </span>
        </div>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={17} /> <span>{error}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="del-reason">Reason</label>
          <textarea id="del-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="del-itsm">ITSM reference (optional)</label>
          <input id="del-itsm" className="input" value={itsmRef} onChange={(e) => setItsmRef(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
