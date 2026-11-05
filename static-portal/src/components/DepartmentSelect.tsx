/**
 * Department picker. The list comes from the portal configuration (public config `departments`).
 * A value that is no longer in the list (set before the list existed or changed) is still shown and kept.
 * With no list configured it falls back to a text box.
 */
export default function DepartmentSelect({
  id,
  value,
  onChange,
  departments,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  departments: string[];
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  if (departments.length === 0) {
    return (
      <input
        id={id}
        className={`input${invalid ? ' invalid' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Network Operations"
        autoFocus={autoFocus}
      />
    );
  }
  const legacy = value && !departments.includes(value) ? [value] : [];
  return (
    <select id={id} className={`select${invalid ? ' invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}>
      <option value="">Choose a department…</option>
      {legacy.map((d) => (
        <option key={d} value={d}>
          {d} (not in the list)
        </option>
      ))}
      {departments.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  );
}
