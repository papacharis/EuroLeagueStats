import { useEffect, useRef } from 'react';

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className="tool-btn" onClick={onClose} aria-label="Κλείσιμο">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
  danger = false,
}: {
  title: string;
  message: React.ReactNode;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="mb-4">{message}</div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Άκυρο
        </button>
        <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} autoFocus>
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
