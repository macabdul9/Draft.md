import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { DraftlyPlugin, type DecorationContext } from 'draftly/src/editor/plugin.ts';
import type { WorkspaceFileSystem } from '../filesystem/adapter';
import type { Preferences } from '../storage/preferences';
class ResearchWidget extends WidgetType {
  private dispose?: () => void;
  constructor(
    private source: string,
    private path: string,
    private fs: WorkspaceFileSystem,
    private preferences: Preferences,
    private click: (target: HTMLElement) => void,
  ) {
    super();
  }
  eq(other: ResearchWidget) {
    return (
      this.source === other.source &&
      this.path === other.path &&
      this.preferences === other.preferences
    );
  }
  toDOM(view: EditorView) {
    const element = document.createElement('span');
    element.className = 'research-widget markdown';
    element.textContent = 'Rendering…';
    let alive = true;
    this.dispose = () => {
      alive = false;
    };
    void import('./render')
      .then(async ({ renderMarkdown }) => {
        const result = await renderMarkdown(this.source, this.path, this.fs, this.preferences);
        if (!alive) {
          result.dispose();
          return;
        }
        element.innerHTML = result.html;
        this.dispose = () => {
          alive = false;
          result.dispose();
        };
        element.addEventListener('click', (event) => {
          const target = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-local-link],[data-wiki],[data-copy-code]',
          );
          if (!target) return;
          event.preventDefault();
          if (target.hasAttribute('data-copy-code')) {
            void navigator.clipboard.writeText(
              target.closest('.code-block')?.querySelector('code')?.textContent ?? '',
            );
          } else this.click(target);
        });
        view.requestMeasure();
      })
      .catch((error) => {
        if (alive) element.textContent = String(error);
      });
    return element;
  }
  destroy() {
    this.dispose?.();
  }
  ignoreEvent() {
    return true;
  }
}
/** Viewport-limited additions; Draftly owns standard formatting, these own local assets. */
export class ResearchPlugin extends DraftlyPlugin {
  readonly name = 'research-local';
  readonly version = '1.0.0';
  constructor(
    private path: string,
    private fs: WorkspaceFileSystem,
    private preferences: Preferences,
    private click: (target: HTMLElement) => void,
  ) {
    super();
  }
  buildDecorations(ctx: DecorationContext) {
    const { view } = ctx;
    for (const range of view.visibleRanges)
      syntaxTree(view.state).iterate({
        from: range.from,
        to: range.to,
        enter: (node) => {
          if (node.name === 'Image') {
            if (
              !ctx.cursorInRange(node.from, node.to) &&
              !ctx.selectionOverlapsRange(node.from, node.to)
            )
              ctx.decorations.push(
                Decoration.replace({
                  widget: new ResearchWidget(
                    view.state.sliceDoc(node.from, node.to),
                    this.path,
                    this.fs,
                    this.preferences,
                    this.click,
                  ),
                }).range(node.from, node.to),
              );
            return false;
          }
          if (node.name === 'FencedCode') {
            const source = view.state.sliceDoc(node.from, node.to);
            if (
              (/^```mermaid/.test(source) && this.preferences.mermaid) ||
              (/^(`{3,}|~{3,})latex\s*\n/.test(source) &&
                /\\begin\{(?:table|tabular)\}/.test(source))
            )
              ctx.decorations.push(
                Decoration.widget({
                  widget: new ResearchWidget(
                    source,
                    this.path,
                    this.fs,
                    this.preferences,
                    this.click,
                  ),
                  side: 1,
                }).range(node.to),
              );
            return false;
          }
          if (/Code|HTML/.test(node.name)) return false;
          if (node.name === 'Paragraph' && this.preferences.math) {
            const source = view.state.sliceDoc(node.from, node.to);
            for (const match of source.matchAll(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g)) {
              const from = node.from + match.index!,
                to = from + match[0].length;
              let syntax = syntaxTree(view.state).resolveInner(from, 1);
              let inCode = false;
              while (syntax.parent) {
                if (syntax.name === 'InlineCode') inCode = true;
                syntax = syntax.parent;
              }
              if (inCode) continue;
              if (ctx.cursorInRange(from, to) || ctx.selectionOverlapsRange(from, to)) continue;
              if (!match[0].includes('\n'))
                ctx.decorations.push(
                  Decoration.replace({
                    widget: new ResearchWidget(
                      match[0],
                      this.path,
                      this.fs,
                      this.preferences,
                      this.click,
                    ),
                  }).range(from, to),
                );
              else
                ctx.decorations.push(
                  Decoration.widget({
                    widget: new ResearchWidget(
                      match[0],
                      this.path,
                      this.fs,
                      this.preferences,
                      this.click,
                    ),
                    side: 1,
                  }).range(to),
                );
            }
          }
          if (node.name === 'Paragraph') {
            const source = view.state.sliceDoc(node.from, node.to);
            for (const match of source.matchAll(/\[@[^\]]+\]|\[\[[^\]]+\]\]/g))
              ctx.decorations.push(
                Decoration.mark({
                  class: match[0].startsWith('[@') ? 'citation' : 'wiki-link',
                }).range(node.from + match.index!, node.from + match.index! + match[0].length),
              );
          }
        },
      });
  }
}
