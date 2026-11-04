import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

type Kind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
}

interface ToastApi {
  info: (text: string) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  show: (kind: Kind, text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((kind: Kind, text: string) => {
    const id = nextId++;
    setItems((list) => [...list, { id, kind, text }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (t) => show('info', t),
      success: (t) => show('success', t),
      error: (t) => show('error', t),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
