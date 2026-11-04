import type { AccessLevel, ChangeRequest, CrStatus, MappingType, Me, Operation } from './types';

export const isAdmin = (me: Me) => me.level === 'ADMIN';
export const isChecker = (me: Me) => me.level === 'CHECKER' || me.level === 'ADMIN';
export const canWrite = (me: Me) => me.level === 'WRITE' || isChecker(me);

export function levelLabel(level: AccessLevel): string {
  switch (level) {
    case 'READ':
      return 'Read only';
    case 'WRITE':
      return 'Read + Write';
    case 'CHECKER':
      return 'Checker';
    case 'ADMIN':
      return 'Admin';
    default:
      return 'No access';
  }
}

export const mappingLabel: Record<MappingType, string> = {
  SINGLE: 'One-to-one',
  MULTI: 'One-to-many',
  PTR: 'PTR',
};

export const operationLabel: Record<Operation, string> = {
  CREATE: 'Create',
  MODIFY: 'Modify',
  DELETE: 'Delete',
  ROLLBACK: 'Rollback',
};

/** "Modify app.bank.example" style label; a rollback names the version it restores. */
export function changeLabel(cr: Pick<ChangeRequest, 'operation' | 'targetVersion'>): string {
  return cr.operation === 'ROLLBACK' && cr.targetVersion ? `Rollback to v${cr.targetVersion}` : operationLabel[cr.operation];
}

export const statusLabel: Record<CrStatus, string> = {
  PENDING_APPROVAL: 'Pending approval',
  SCHEDULED: 'Scheduled',
  HELD: 'Held for Admin',
  APPLIED: 'Applied',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} d ago`;
  return fmtDateTime(iso);
}

export function initials(name: string): string {
  const parts = name.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ptrNameFor(ip: string): string {
  const parts = ip.trim().split('.');
  return parts.length === 4 && parts.every((p) => p !== '') ? `${[...parts].reverse().join('.')}.in-addr.arpa` : '';
}

export const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Toast text after a submit / approve. */
export function resultMessage(cr: ChangeRequest): { kind: 'success' | 'error' | 'info'; text: string } {
  if (cr.status === 'APPLIED') {
    return { kind: 'success', text: `${cr.number} applied${cr.direct ? ' directly' : ''}${cr.resultVersion ? ` · now v${cr.resultVersion}` : ''}.` };
  }
  if (cr.status === 'FAILED') return { kind: 'error', text: `${cr.number} failed: ${cr.errorMessage ?? 'see the request for details.'}` };
  if (cr.status === 'SCHEDULED') return { kind: 'success', text: `${cr.number} scheduled for ${fmtDateTime(cr.scheduledAt)}.` };
  if (cr.status === 'HELD') return { kind: 'info', text: `${cr.number} is held for the Admin: ${cr.errorMessage ?? ''}` };
  if (cr.status === 'PENDING_APPROVAL') {
    return {
      kind: 'info',
      text: cr.scheduledAt
        ? `${cr.number} sent to the Checkers. Once approved it runs at ${fmtDateTime(cr.scheduledAt)}.`
        : `${cr.number} sent to the Checkers for approval.`,
    };
  }
  return { kind: 'info', text: `${cr.number} is ${statusLabel[cr.status].toLowerCase()}.` };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date -> value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value of <input type="datetime-local"> -> ISO instant, or null when empty / invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Short time zone name of this browser, e.g. "IST". */
export function zoneName(): string {
  const part = new Intl.DateTimeFormat('en-IN', { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'local time';
}

/** "in 3 h", "in 2 d" for a future time. */
export function timeUntil(iso?: string | null): string {
  if (!iso) return '';
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'due now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}
