import { useEffect, useRef, type ReactNode } from 'react';
import { X, Star, BookOpen } from 'lucide-react';

export function IconButton({ label, children, onClick, className = '', disabled = false }: { label: string; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const panel = ref.current!;
    (panel.querySelector('[data-autofocus]') as HTMLElement || panel).focus();
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const focusables = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]')];
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="关闭弹窗" onClick={onClose}><X size={19} /></IconButton></div>
      {children}
    </div>
  </div>;
}

export function Stars({ value, onChange, size = 15 }: { value: number; onChange?: (value: number) => void; size?: number }) {
  return <div className={`stars ${onChange ? 'interactive-stars' : ''}`} aria-label={`${value} 星`}>
    {[1,2,3,4,5].map(n => onChange ? <button key={n} type="button" onClick={() => onChange(n)} aria-label={`评为 ${n} 星`}><Star size={size} fill={n <= value ? 'currentColor' : 'none'} className={n <= value ? '' : 'empty-star'} /></button> : <Star key={n} size={size} fill={n <= value ? 'currentColor' : 'none'} className={n <= value ? '' : 'empty-star'} />)}
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><BookOpen size={32} strokeWidth={1.2} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
