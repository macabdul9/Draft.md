import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentProvider } from '../agents/providers';
import { writeWithAgent } from '../agents/writing';

export default function AgentWriter({
  initialPrompt,
  initialEngine,
  context,
  selection,
  onClose,
  onError,
  onInsert,
}: {
  initialPrompt: string;
  initialEngine?: AgentProvider;
  context: string;
  selection: string;
  onClose: () => void;
  onError: (message: string) => void;
  onInsert: (text: string, force?: boolean, partial?: boolean) => boolean;
}) {
  const [status, setStatus] = useState('Writing…');
  const [draft, setDraft] = useState('');
  const controller = useRef<AbortController>();
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const stop = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        abort.abort();
        onClose();
      }
    };
    window.addEventListener('keydown', stop);
    void writeWithAgent(
      {
        prompt:
          initialPrompt ||
          (selection
            ? 'Improve this selection. Keep its meaning.'
            : 'Continue this note with a short useful paragraph.'),
        engine: initialEngine,
        context,
        selection,
      },
      abort.signal,
      setStatus,
      () => {},
      (text) => {
        if (!abort.signal.aborted) onInsert(text, false, true);
      },
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        if (onInsert(result.text)) {
          onClose();
        } else {
          setDraft(result.text);
          setStatus('Draft ready · note changed');
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          onError(failure instanceof Error ? failure.message : String(failure));
          onClose();
        }
      });
    return () => {
      abort.abort();
      window.removeEventListener('keydown', stop);
    };
  }, []);
  return (
    <span class="agent-inline-status" role="status">
      {!draft && <span class="agent-progress-spinner" aria-hidden="true" />}
      {status}
      {draft ? (
        <details class="agent-recovered-draft">
          <summary>Review draft</summary>
          <textarea
            aria-label="Recovered draft"
            rows={6}
            value={draft}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button
            onClick={() => {
              if (onInsert(draft, true)) onClose();
            }}
          >
            Insert at cursor
          </button>
          <button onClick={onClose}>Discard</button>
        </details>
      ) : (
        <button
          onClick={() => {
            controller.current?.abort();
            onClose();
          }}
        >
          Stop · Esc
        </button>
      )}
    </span>
  );
}
