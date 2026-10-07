import { useEffect, useRef } from 'preact/hooks';
import { FileText, X, Plus } from 'lucide-preact';
import { basename } from '../filesystem/adapter';
import type { DocumentController } from '../state/documents';
export function Tabs({
  paths,
  active,
  controller,
  onOpen,
  onClose,
  onNew,
}: {
  paths: string[];
  active: string;
  controller: DocumentController;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  onNew: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      for (const node of root.current?.querySelectorAll<HTMLElement>('[data-dirty]') ?? []) {
        const doc = controller.documents.get(node.dataset.dirty!);
        node.hidden = !doc || doc.status === 'saved';
      }
    };
    update();
    return controller.subscribe(update);
  }, [controller, paths]);
  return (
    <div class="tab-strip" ref={root} role="tablist" aria-label="Open documents">
      {paths.map((path) => (
        <div
          class={`tab ${path === active ? 'active' : ''}`}
          onAuxClick={(event) => {
            if (event.button === 1) onClose(path);
          }}
        >
          <button role="tab" aria-selected={path === active} onClick={() => onOpen(path)}>
            <FileText size={14} />
            <span>{basename(path)}</span>
            <span class="dirty-dot" data-dirty={path} hidden />
          </button>
          <button
            class="tab-close"
            aria-label={`Close ${basename(path)}`}
            onClick={() => onClose(path)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        class="icon-button new-tab"
        title="New note"
        aria-label="New note tab"
        onClick={onNew}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
