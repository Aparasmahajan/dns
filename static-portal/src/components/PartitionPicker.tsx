import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Search } from 'lucide-react';

export interface PickerItem {
  id: number;
  name: string;
  description?: string | null;
  recordCount?: number;
}

/**
 * Multi-select list of F5 partitions with search. Used by the Admin (assign partitions to a Read + Write user)
 * and by a user raising an access request. Search matches the partition name or description.
 */
export default function PartitionPicker({
  label,
  items,
  selected,
  onChange,
  empty,
  error,
}: {
  label: string;
  items: PickerItem[];
  selected: number[];
  onChange: (ids: number[]) => void;
  empty: ReactNode;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const term = query.trim().toLowerCase();

  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (!onlySelected || selected.includes(i.id)) &&
          (!term || i.name.toLowerCase().includes(term) || (i.description ?? '').toLowerCase().includes(term)),
      ),
    [items, term, onlySelected, selected],
  );

  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const allShownSelected = shown.length > 0 && shown.every((i) => selected.includes(i.id));
  function toggleShown() {
    const ids = shown.map((i) => i.id);
    onChange(allShownSelected ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set([...selected, ...ids])));
  }

  return (
    <div className="field">
      <div className="label-row">
        <span className="label">{label}</span>
        <span className="hint">
          {selected.length} of {items.length} selected
        </span>
      </div>
      {items.length === 0 ? (
        <div className="alert alert-warn">
          <AlertTriangle size={17} /> <span>{empty}</span>
        </div>
      ) : (
        <>
          <div className="picker-tools">
            <div className="search-box picker-search">
              <Search size={15} />
              <input
                className="input"
                placeholder="Search partitions by name or description"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter must not submit the surrounding form; Esc clears the search before it closes the dialog.
                  if (e.key === 'Enter') e.preventDefault();
                  if (e.key === 'Escape' && query) {
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                    setQuery('');
                  }
                }}
                aria-label="Search partitions"
              />
            </div>
            <label className="checkbox small">
              <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Selected only
            </label>
            {shown.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={toggleShown}>
                {allShownSelected ? 'Clear shown' : `Select shown (${shown.length})`}
              </button>
            )}
          </div>
          <div className="check-list">
            {shown.length === 0 ? (
              <div className="muted small" style={{ padding: '10px 9px' }}>
                {onlySelected && !term ? 'Nothing selected yet.' : `No partitions match “${query.trim()}”.`}
              </div>
            ) : (
              shown.map((i) => (
                <label key={i.id} className="check-row">
                  <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
                  <span className="cr-main">
                    <span className="mono">{i.name}</span>
                    {i.description && <span className="muted small">{i.description}</span>}
                  </span>
                  {i.recordCount !== undefined && (
                    <span className="muted small cr-side">
                      {i.recordCount} record{i.recordCount === 1 ? '' : 's'}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
          {term && shown.length > 0 && (
            <span className="hint">
              Showing {shown.length} of {items.length}
            </span>
          )}
        </>
      )}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
