import { useEffect, useRef, useState } from 'preact/hooks';
import { Search, Command, FileText, ArrowRight } from 'lucide-preact';
import { Dialog } from './Dialog';
import type { SearchClient } from '../search/client';
import type { SearchResult } from '../search/index';
export interface CommandItem {
  name: string;
  shortcut?: string;
  run: () => void;
}
export function Palette({
  kind,
  search,
  commands,
  onOpen,
  onClose,
}: {
  kind: 'quick' | 'search' | 'command';
  search?: SearchClient;
  commands: CommandItem[];
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<SearchResult[]>([]),
    [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const filtered = commands.filter((command) =>
    command.name.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    let alive = true;
    setIndex(0);
    const timer = setTimeout(() => {
      if (kind !== 'command' && search)
        void search.query(query, kind === 'quick').then((value) => {
          if (alive) setResults(value);
        });
    }, 100);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, search, kind]);
  const activate = (i: number) => {
    if (kind === 'command') {
      filtered[i]?.run();
      onClose();
    } else if (results[i]) {
      onOpen(results[i].path, kind === 'quick' ? 0 : results[i].line);
      onClose();
    }
  };
  const length = kind === 'command' ? filtered.length : results.length;
  return (
    <Dialog
      title={
        kind === 'command'
          ? 'Command Palette'
          : kind === 'quick'
            ? 'Quick Open'
            : 'Search workspace'
      }
      onClose={onClose}
    >
      <div class="palette-input">
        {kind === 'command' ? <Command size={18} /> : <Search size={18} />}
        <input
          ref={input}
          placeholder={
            kind === 'command'
              ? 'What would you like to do?'
              : kind === 'quick'
                ? 'Find a file by name or path…'
                : 'Search your workspace…'
          }
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((v) => Math.min(length - 1, v + 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((v) => Math.max(0, v - 1));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              activate(index);
            }
          }}
          role="combobox"
          aria-expanded={true}
          aria-controls="palette-results"
          aria-activedescendant={`result-${index}`}
        />
      </div>
      <div class="palette-results" id="palette-results" role="listbox">
        {kind === 'command'
          ? filtered.map((command, i) => (
              <button
                id={`result-${i}`}
                role="option"
                aria-selected={index === i}
                class={index === i ? 'selected' : ''}
                onClick={() => activate(i)}
              >
                <Command size={14} />
                <span>{command.name}</span>
                <kbd>{command.shortcut}</kbd>
              </button>
            ))
          : results.map((result, i) => (
              <button
                id={`result-${i}`}
                role="option"
                aria-selected={index === i}
                class={index === i ? 'selected' : ''}
                onClick={() => activate(i)}
              >
                <FileText size={16} />
                <span>
                  <strong>{result.path}</strong>
                  {kind === 'search' && (
                    <small>
                      Line {result.line} · {result.snippet}
                    </small>
                  )}
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
        {!length && (
          <div class="quiet-empty">
            {query ? 'No matching results.' : 'Start typing to find your notes.'}
          </div>
        )}
      </div>
      <div class="palette-hint">
        <span>↑ ↓ to navigate</span>
        <span>↵ to open</span>
        <span>esc to close</span>
      </div>
    </Dialog>
  );
}
