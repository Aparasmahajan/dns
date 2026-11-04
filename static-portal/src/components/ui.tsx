import { useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Globe, Inbox, Loader2, X } from 'lucide-react';
import { statusLabel } from '../format';
import type { CrStatus, MappingType, UserStatus } from '../types';

export function Brand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Globe size={22} strokeWidth={1.8} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="brand-name">{title}</div>
        <div className="brand-sub">{subtitle}</div>
      </div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscape(onClose);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            {subtitle && <div className="muted" style={{ marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

export function CrStatusBadge({ status }: { status: CrStatus }) {
  const cls =
    status === 'APPLIED'
      ? 'badge-green'
      : status === 'PENDING_APPROVAL' || status === 'HELD'
        ? 'badge-amber'
        : status === 'SCHEDULED'
          ? 'badge-blue'
          : status === 'CANCELLED'
            ? 'badge-grey'
            : 'badge-red';
  return <span className={`badge ${cls}`}>{statusLabel[status]}</span>;
}

export function UserStatusBadge({ status, locked }: { status: UserStatus; locked?: boolean }) {
  if (locked && status !== 'DISABLED') return <span className="badge badge-red">Locked</span>;
  if (status === 'PENDING') return <span className="badge badge-amber">Pending access</span>;
  if (status === 'DISABLED') return <span className="badge badge-grey">Disabled</span>;
  return <span className="badge badge-green">Active</span>;
}

export function MappingTag({ type }: { type: MappingType }) {
  if (type === 'PTR') return <span className="tag tag-ptr">PTR</span>;
  if (type === 'MULTI') return <span className="tag tag-multi">A · 1→many</span>;
  return <span className="tag tag-a">A · 1→1</span>;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="loading">
      <Loader2 size={18} className="spin" /> {text}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={34} />}
      <div className="e-title">{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  totalElements,
  onPage,
  noun = 'items',
}: {
  page: number;
  totalPages: number;
  totalElements: number;
  onPage: (p: number) => void;
  noun?: string;
}) {
  if (totalElements === 0) return null;
  return (
    <div className="pager">
      <span>
        {totalElements.toLocaleString('en-IN')} {noun}
      </span>
      <div className="right">
        <span style={{ alignSelf: 'center', marginRight: 6 }}>
          Page {page + 1} of {Math.max(totalPages, 1)}
        </span>
        <button className="btn btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <button className="btn btn-sm" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
