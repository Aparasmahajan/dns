import { CalendarClock, Zap } from 'lucide-react';
import { fromLocalInput, toLocalInput, zoneName } from '../format';

/** "Run now" or "at this local date/time" (value of a datetime-local input). */
export interface ScheduleValue {
  mode: 'now' | 'later';
  at: string;
}

// Mirrors the server defaults (SCHEDULE_MIN_LEAD_SECONDS, SCHEDULE_MAX_DAYS_AHEAD); the server has the final say.
const MIN_LEAD_MS = 60_000;
const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;

export function scheduleFrom(iso: string | null | undefined): ScheduleValue {
  return iso ? { mode: 'later', at: toLocalInput(new Date(iso)) } : { mode: 'now', at: '' };
}

export function scheduleIso(v: ScheduleValue): string | null {
  return v.mode === 'now' ? null : fromLocalInput(v.at);
}

export function scheduleError(v: ScheduleValue): string | null {
  if (v.mode === 'now') return null;
  if (!v.at) return 'Choose the date and time.';
  const t = new Date(v.at).getTime();
  if (Number.isNaN(t)) return 'Enter a valid date and time.';
  if (t < Date.now() + MIN_LEAD_MS) return 'Choose a time at least 1 minute from now.';
  if (t > Date.now() + MAX_AHEAD_MS) return 'You can schedule at most 90 days ahead.';
  return null;
}

/** Next full hour, at least 15 minutes away: a sensible default when switching to "Schedule". */
function defaultTime(): string {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

export default function ScheduleField({
  value,
  onChange,
  error,
  nowTitle,
  nowDesc,
  laterDesc,
}: {
  value: ScheduleValue;
  onChange: (v: ScheduleValue) => void;
  error?: string | null;
  nowTitle: string;
  nowDesc: string;
  laterDesc: string;
}) {
  return (
    <div className="field">
      <span className="label">When</span>
      <div className="options options-2">
        <button type="button" className={`option${value.mode === 'now' ? ' active' : ''}`} onClick={() => onChange({ ...value, mode: 'now' })}>
          <span className="o-title">
            <Zap size={16} /> {nowTitle}
          </span>
          <span className="o-desc">{nowDesc}</span>
        </button>
        <button
          type="button"
          className={`option${value.mode === 'later' ? ' active' : ''}`}
          onClick={() => onChange({ mode: 'later', at: value.at || defaultTime() })}
        >
          <span className="o-title">
            <CalendarClock size={16} /> Schedule
          </span>
          <span className="o-desc">{laterDesc}</span>
        </button>
      </div>
      {value.mode === 'later' && (
        <div className="schedule-at">
          <input
            type="datetime-local"
            className={`input${error ? ' invalid' : ''}`}
            value={value.at}
            min={toLocalInput(new Date(Date.now() + MIN_LEAD_MS))}
            onChange={(e) => onChange({ mode: 'later', at: e.target.value })}
            aria-label="Scheduled date and time"
          />
          {error ? (
            <span className="error-text">{error}</span>
          ) : (
            <span className="hint">Your time zone ({zoneName()}). The active portal site runs it within a few seconds of this time.</span>
          )}
        </div>
      )}
    </div>
  );
}
