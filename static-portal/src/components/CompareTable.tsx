import type { ReactNode } from 'react';
import { mappingLabel } from '../format';
import type { RecordType, Snapshot } from '../types';

interface Row {
  label: string;
  left: ReactNode;
  right: ReactNode;
  changed: boolean;
}

const text = (v: string | null | undefined) => (v ? <span className="mono">{v}</span> : <span className="muted">—</span>);

/** IP lists side by side: on the right, new IPs are green; on the left, IPs that go away are struck through. */
function ipCells(left: string[], right: string[]): { l: ReactNode; r: ReactNode; changed: boolean } {
  const l = new Set(left);
  const r = new Set(right);
  const changed = left.length !== right.length || left.some((ip) => !r.has(ip));
  return {
    changed,
    l: left.length ? (
      <div className="ip-list">
        {left.map((ip) => (
          <span key={ip} className={`ip-chip${r.has(ip) ? '' : ' removed'}`}>
            {ip}
          </span>
        ))}
      </div>
    ) : (
      <span className="muted">—</span>
    ),
    r: right.length ? (
      <div className="ip-list">
        {right.map((ip) => (
          <span key={ip} className={`ip-chip${l.has(ip) ? '' : ' added'}`}>
            {ip}
          </span>
        ))}
      </div>
    ) : (
      <span className="muted">—</span>
    ),
  };
}

/** Field-level comparison of two record configurations (versions, or current vs. proposed). */
export default function CompareTable({
  left,
  right,
  leftTitle,
  rightTitle,
  recordType,
}: {
  left: Snapshot;
  right: Snapshot;
  leftTitle: ReactNode;
  rightTitle: ReactNode;
  recordType: RecordType;
}) {
  const ptr = recordType === 'PTR';
  const rows: Row[] = [];
  const add = (label: string, a?: string | null, b?: string | null) => rows.push({ label, left: text(a), right: text(b), changed: (a ?? '') !== (b ?? '') });

  add('Mapping', left.mappingType && mappingLabel[left.mappingType], right.mappingType && mappingLabel[right.mappingType]);
  if (ptr) {
    add('IP address', left.ips?.[0], right.ips?.[0]);
    add('PTR name', left.ptrName, right.ptrName);
    add('Points to', left.domain, right.domain);
  } else {
    add('Domain', left.domain, right.domain);
    const ips = ipCells(left.ips ?? [], right.ips ?? []);
    rows.push({ label: 'IP addresses', left: ips.l, right: ips.r, changed: ips.changed });
  }
  add('TTL', left.ttl === undefined ? null : `${left.ttl} s`, right.ttl === undefined ? null : `${right.ttl} s`);
  if (left.status === 'DELETED' || right.status === 'DELETED') {
    const state = (s?: string) => (s === 'DELETED' ? 'Deleted' : 'Active');
    rows.push({ label: 'State', left: state(left.status), right: state(right.status), changed: left.status !== right.status });
  }
  const differences = rows.filter((r) => r.changed).length;

  return (
    <>
      <div className="card">
        <table className="table compare">
          <thead>
            <tr>
              <th>Field</th>
              <th>{leftTitle}</th>
              <th>{rightTitle}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="label">{row.label}</td>
                <td>{row.left}</td>
                <td className={row.changed ? 'changed' : undefined}>{row.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span>{differences === 0 ? 'No differences' : differences === 1 ? '1 field differs' : `${differences} fields differ`}</span>
        <span>
          <span className="ip-chip added">10.0.0.1</span> added
        </span>
        <span>
          <span className="ip-chip removed">10.0.0.2</span> removed
        </span>
      </div>
    </>
  );
}
