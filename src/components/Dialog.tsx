import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { X } from 'lucide-preact';
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      class={`dialog ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button class="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export interface RequestSpec {
  title: string;
  message?: string;
  initial?: string;
  label?: string;
  confirm?: string;
  danger?: boolean;
  choice?: {
    label: string;
    options: { id: string; name: string }[];
    onChange: (value: string) => void;
  };
  resolve: (value: string | null) => void;
}
export function RequestDialog({ request, onClose }: { request: RequestSpec; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (value: string | null) => {
    request.resolve(value);
    onClose();
  };
  return (
    <Dialog title={request.title} onClose={() => finish(null)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          finish(request.initial !== undefined ? input.current!.value : 'yes');
        }}
      >
        <div class="dialog-body">
          {request.message && <p>{request.message}</p>}
          {request.choice && (
            <label>
              {request.choice.label}
              <select
                aria-label={request.choice.label}
                onChange={(event) => request.choice?.onChange(event.currentTarget.value)}
              >
                {request.choice.options.map((option) => (
                  <option value={option.id}>{option.name}</option>
                ))}
              </select>
            </label>
          )}
          {request.initial !== undefined && (
            <label>
              {request.label ?? 'Name'}
              <input ref={input} defaultValue={request.initial} required autoComplete="off" />
            </label>
          )}
        </div>
        <footer>
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button class={request.danger ? 'danger' : 'primary'}>{request.confirm ?? 'Save'}</button>
        </footer>
      </form>
    </Dialog>
  );
}
