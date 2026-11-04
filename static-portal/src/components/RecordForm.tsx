import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, CalendarClock, GitFork, Info, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { DOMAIN_RE, IPV4_RE, changeLabel, fmtDateTime, isChecker, ptrNameFor } from '../format';
import type { ChangeRequest, DnsRecord, MappingType, Ref } from '../types';
import ScheduleField, { scheduleError, scheduleFrom, scheduleIso, type ScheduleValue } from './ScheduleField';
import { Modal } from './ui';

export type RecordFormMode =
  | { kind: 'create' }
  | { kind: 'modify'; record: DnsRecord }
  | { kind: 'editRequest'; request: ChangeRequest };

const MAPPINGS: { type: MappingType; title: string; desc: string; icon: ReactNode }[] = [
  { type: 'SINGLE', title: 'One-to-one', desc: 'One domain → one IP (A record)', icon: <ArrowRight size={16} /> },
  { type: 'MULTI', title: 'One-to-many', desc: 'One domain → several IPs (A records)', icon: <GitFork size={16} /> },
  { type: 'PTR', title: 'PTR (reverse)', desc: 'One IP → one domain', icon: <ArrowLeftRight size={16} /> },
];

interface FormState {
  mappingType: MappingType;
  groupId: number;
  domain: string;
  ips: string[];
  ttl: string;
  reason: string;
  itsmRef: string;
}

function initialState(mode: RecordFormMode, groups: Ref[]): FormState {
  if (mode.kind === 'modify') {
    const r = mode.record;
    return { mappingType: r.mappingType, groupId: r.group.id, domain: r.domain, ips: [...r.ips], ttl: String(r.ttl), reason: '', itsmRef: '' };
  }
  if (mode.kind === 'editRequest') {
    const c = mode.request;
    const p = c.proposed ?? {};
    return {
      mappingType: p.mappingType ?? 'SINGLE',
      groupId: c.group.id,
      domain: p.domain ?? '',
      ips: p.ips && p.ips.length ? [...p.ips] : [''],
      ttl: String(p.ttl ?? 3600),
      reason: c.reason,
      itsmRef: c.itsmRef ?? '',
    };
  }
  return { mappingType: 'SINGLE', groupId: groups.length === 1 ? groups[0].id : 0, domain: '', ips: [''], ttl: '3600', reason: '', itsmRef: '' };
}

export default function RecordForm({
  mode,
  groups,
  onClose,
  onDone,
}: {
  mode: RecordFormMode;
  groups: Ref[];
  onClose: () => void;
  onDone: (cr: ChangeRequest) => void;
}) {
  const me = useMe();
  const [form, setForm] = useState<FormState>(() => initialState(mode, groups));
  const [schedule, setSchedule] = useState<ScheduleValue>(() => scheduleFrom(mode.kind === 'editRequest' ? mode.request.scheduledAt : null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const direct = mode.kind === 'editRequest' ? mode.request.direct : isChecker(me);
  // Scheduling is only for changes to an existing record; a new record is created now (or when approved).
  const isCreate = mode.kind === 'create' || (mode.kind === 'editRequest' && mode.request.operation === 'CREATE');
  const later = !isCreate && schedule.mode === 'later';
  const isPtr = form.mappingType === 'PTR';
  // An existing record keeps its key (domain for A, IP for PTR) and its record type.
  const existingType =
    mode.kind === 'modify' ? mode.record.recordType : mode.kind === 'editRequest' && mode.request.operation === 'MODIFY' ? mode.request.recordType : null;
  const keyLocked = existingType !== null;
  const showGroupPicker = mode.kind === 'create';

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  function chooseMapping(t: MappingType) {
    setForm((f) => {
      const first = f.ips[0] ?? '';
      const ips = t === 'MULTI' ? (f.ips.length >= 2 ? f.ips : [first, '']) : [first];
      return { ...f, mappingType: t, ips };
    });
  }

  function setIp(index: number, value: string) {
    setForm((f) => ({ ...f, ips: f.ips.map((ip, i) => (i === index ? value : ip)) }));
  }

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (showGroupPicker && !form.groupId) e.group = 'Choose the partition that owns this record.';
    const domain = form.domain.trim().replace(/\.$/, '');
    if (!DOMAIN_RE.test(domain)) e.domain = 'Enter a fully qualified domain name, e.g. app.example.com';
    const used = form.mappingType === 'MULTI' ? form.ips : form.ips.slice(0, 1);
    const seen = new Set<string>();
    used.forEach((raw, i) => {
      const ip = raw.trim();
      if (!IPV4_RE.test(ip)) e[`ip${i}`] = 'Enter a valid IPv4 address, e.g. 10.20.30.40';
      else if (seen.has(ip)) e[`ip${i}`] = 'This IP is already listed.';
      seen.add(ip);
    });
    if (form.mappingType === 'MULTI' && used.length < 2) e.ips = 'Add at least two IP addresses.';
    const ttl = Number(form.ttl);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) e.ttl = 'TTL must be a whole number between 60 and 86400 seconds.';
    if (!form.reason.trim()) e.reason = 'Give a short reason for this change.';
    const when = isCreate ? null : scheduleError(schedule);
    if (when) e.schedule = when;
    return e;
  }, [form, showGroupPicker, schedule, isCreate]);

  const show = (key: string) => (tried ? errors[key] : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setServerError(null);
    const spec = {
      mappingType: form.mappingType,
      domain: form.domain.trim(),
      ips: (form.mappingType === 'MULTI' ? form.ips : form.ips.slice(0, 1)).map((s) => s.trim()),
      ttl: Number(form.ttl),
    };
    const scheduledAt = isCreate ? null : scheduleIso(schedule);
    try {
      let cr: ChangeRequest;
      if (mode.kind === 'create') {
        cr = await api.post<ChangeRequest>('/api/change-requests', {
          operation: 'CREATE',
          groupId: form.groupId,
          spec,
          reason: form.reason,
          itsmRef: form.itsmRef,
          scheduledAt,
        });
      } else if (mode.kind === 'modify') {
        cr = await api.post<ChangeRequest>('/api/change-requests', {
          operation: 'MODIFY',
          recordId: mode.record.id,
          spec,
          reason: form.reason,
          itsmRef: form.itsmRef,
          scheduledAt,
        });
      } else {
        cr = await api.put<ChangeRequest>(`/api/change-requests/${mode.request.id}`, { spec, reason: form.reason, itsmRef: form.itsmRef, scheduledAt });
      }
      onDone(cr);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode.kind === 'create' ? 'New DNS record' : mode.kind === 'modify' ? `Modify ${mode.record.key}` : `Edit request ${mode.request.number}`;
  const submitLabel =
    mode.kind === 'editRequest'
      ? direct && !later
        ? 'Save and apply now'
        : 'Save request'
      : direct
        ? later
          ? 'Validate and schedule'
          : 'Validate and apply'
        : 'Submit for approval';
  const scheduledOnRecord = mode.kind === 'modify' ? mode.record.scheduled : null;
  const backToApproval = mode.kind === 'editRequest' && !mode.request.direct && mode.request.status === 'SCHEDULED';
  const ptrPreview = isPtr ? ptrNameFor(form.ips[0] ?? '') : '';
  const groupName = mode.kind === 'modify' ? mode.record.group.name : mode.kind === 'editRequest' ? mode.request.group.name : '';

  const domainField = (
    <div className="field">
      <label htmlFor="domain">{isPtr ? 'Points to (domain name)' : 'Domain name'}</label>
      <input
        id="domain"
        className={`input mono${show('domain') ? ' invalid' : ''}`}
        placeholder={isPtr ? 'host01.bank.example' : 'app.bank.example'}
        value={form.domain}
        disabled={keyLocked && !isPtr}
        onChange={(e) => set('domain', e.target.value)}
        autoFocus={mode.kind === 'create'}
      />
      {keyLocked && !isPtr && <span className="hint">The domain of an existing record cannot be changed.</span>}
      {show('domain') && <span className="error-text">{show('domain')}</span>}
    </div>
  );

  const singleIpField = (
    <div className="field">
      <label htmlFor="ip0">IP address</label>
      <input
        id="ip0"
        className={`input mono${show('ip0') ? ' invalid' : ''}`}
        placeholder="10.20.30.40"
        value={form.ips[0] ?? ''}
        disabled={keyLocked && isPtr}
        onChange={(e) => setIp(0, e.target.value)}
      />
      {keyLocked && isPtr && <span className="hint">The IP of an existing PTR record cannot be changed.</span>}
      {show('ip0') && <span className="error-text">{show('ip0')}</span>}
    </div>
  );

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="record-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : submitLabel}
          </button>
        </>
      }
    >
      <form id="record-form" onSubmit={submit} noValidate>
        {serverError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }} role="alert">
            <AlertTriangle size={17} /> <span>{serverError}</span>
          </div>
        )}
        {scheduledOnRecord && (
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <CalendarClock size={17} />
            <span>
              {scheduledOnRecord.number} ({changeLabel({ operation: scheduledOnRecord.operation, targetVersion: null })}) is{' '}
              {scheduledOnRecord.status === 'HELD' ? 'held for the Admin' : `scheduled for ${fmtDateTime(scheduledOnRecord.scheduledAt)}`} on this record. If
              this change is applied first, that scheduled change will not run as planned.
            </span>
          </div>
        )}
        {backToApproval && (
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <Info size={17} />
            <span>This request is already approved. Saving a change sends it back to the Checkers for re-approval.</span>
          </div>
        )}

        <div className="field">
          <span className="label">Mapping type</span>
          <div className="options">
            {MAPPINGS.map((m) => {
              const allowed = existingType === null || (existingType === 'PTR' ? m.type === 'PTR' : m.type !== 'PTR');
              return (
                <button
                  type="button"
                  key={m.type}
                  className={`option${form.mappingType === m.type ? ' active' : ''}`}
                  disabled={!allowed}
                  onClick={() => chooseMapping(m.type)}
                >
                  <span className="o-title">
                    {m.icon} {m.title}
                  </span>
                  <span className="o-desc">{m.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {showGroupPicker ? (
          <div className="field">
            <label htmlFor="group">Partition</label>
            <select
              id="group"
              className={`select${show('group') ? ' invalid' : ''}`}
              value={form.groupId || ''}
              onChange={(e) => set('groupId', Number(e.target.value))}
            >
              <option value="">Choose a partition…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {groups.length === 0 && <span className="hint">No partitions available. The Admin creates them under Partitions.</span>}
            {show('group') && <span className="error-text">{show('group')}</span>}
          </div>
        ) : (
          <div className="field">
            <span className="label">Partition</span>
            <div>{groupName}</div>
          </div>
        )}

        {form.mappingType === 'PTR' ? (
          <>
            {singleIpField}
            {domainField}
            <div className="field">
              <span className="label">Reverse record name</span>
              <div className="preview">{ptrPreview || 'Enter an IP address to see the PTR name'}</div>
            </div>
          </>
        ) : (
          <>
            {domainField}
            {form.mappingType === 'SINGLE' ? (
              singleIpField
            ) : (
              <div className="field">
                <div className="label-row">
                  <span className="label">IP addresses</span>
                  <span className="hint">{form.ips.length} listed</span>
                </div>
                <div className="ip-rows">
                  {form.ips.map((ip, i) => (
                    <div key={i}>
                      <div className="ip-row">
                        <input
                          className={`input${show(`ip${i}`) ? ' invalid' : ''}`}
                          placeholder={`10.20.30.${40 + i}`}
                          value={ip}
                          onChange={(e) => setIp(i, e.target.value)}
                          aria-label={`IP address ${i + 1}`}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          disabled={form.ips.length <= 2}
                          onClick={() => setForm((f) => ({ ...f, ips: f.ips.filter((_, j) => j !== i) }))}
                          aria-label={`Remove IP address ${i + 1}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {show(`ip${i}`) && <span className="error-text">{show(`ip${i}`)}</span>}
                    </div>
                  ))}
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 8 }}
                    disabled={form.ips.length >= 32}
                    onClick={() => setForm((f) => ({ ...f, ips: [...f.ips, ''] }))}
                  >
                    <Plus size={15} /> Add IP address
                  </button>
                </div>
                {show('ips') && <span className="error-text">{show('ips')}</span>}
              </div>
            )}
          </>
        )}

        <div className="row">
          <div className="field">
            <label htmlFor="ttl">TTL (seconds)</label>
            <input
              id="ttl"
              className={`input${show('ttl') ? ' invalid' : ''}`}
              inputMode="numeric"
              value={form.ttl}
              onChange={(e) => set('ttl', e.target.value.replace(/[^\d]/g, ''))}
            />
            {show('ttl') ? <span className="error-text">{show('ttl')}</span> : <span className="hint">60 – 86400 · default 3600</span>}
          </div>
          <div className="field">
            <label htmlFor="itsm">ITSM reference (optional)</label>
            <input id="itsm" className="input" placeholder="CHG0012345" value={form.itsmRef} onChange={(e) => set('itsmRef', e.target.value)} />
          </div>
        </div>

        {!isCreate && (
          <ScheduleField
            value={schedule}
            onChange={setSchedule}
            error={show('schedule')}
            nowTitle={direct ? 'Apply now' : 'As soon as approved'}
            nowDesc={direct ? 'Validated and applied straight away' : 'Runs on F5 when a Checker approves it'}
            laterDesc={direct ? 'Validated now, applied at the time you choose' : 'Approved first, then runs at the time you choose'}
          />
        )}

        <div className="field">
          <label htmlFor="reason">Reason for change</label>
          <textarea
            id="reason"
            className={`textarea${show('reason') ? ' invalid' : ''}`}
            placeholder="e.g. New load-balanced front end for the payments API"
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
          {show('reason') && <span className="error-text">{show('reason')}</span>}
        </div>

        {mode.kind !== 'editRequest' && (
          <div className={`alert ${direct ? 'alert-warn' : 'alert-info'}`} style={{ marginBottom: 16 }}>
            {direct ? <ShieldCheck size={17} /> : <Info size={17} />}
            <span>
              {direct
                ? later
                  ? 'You are a Checker, so this change is validated now and applied at the scheduled time with no approval step. It is recorded as a direct change.'
                  : 'You are a Checker, so this change is validated and applied straight away with no approval step. It is recorded as a direct change.'
                : later
                  ? 'This change goes to the Checkers for approval. Once approved, it runs at the scheduled time. Nothing changes on F5 before then.'
                  : 'This change goes to the Checkers for approval. Nothing changes on F5 until it is approved.'}
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
}
