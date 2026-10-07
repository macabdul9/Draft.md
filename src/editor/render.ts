import { Marked, type Token, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { resolveAsset, type WorkspaceFileSystem } from '../filesystem/adapter';
import type { Preferences } from '../storage/preferences';
import { renderLatexTable } from './latex-table';
export const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function sanitize(html: string) {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'iframe',
      'object',
      'embed',
      'form',
      'style',
      'script',
      'image',
      'use',
      'foreignObject',
      'video',
      'audio',
      'source',
      'link',
      'meta',
      'base',
    ],
    FORBID_ATTR: ['style', 'srcset', 'poster', 'background'],
    ALLOW_DATA_ATTR: true,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const element of template.content.querySelectorAll('[src],[href],[xlink\\:href]')) {
    for (const attribute of ['src', 'href', 'xlink:href']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      if (attribute === 'src') {
        element.removeAttribute(attribute);
        if (value.startsWith('blob:')) element.setAttribute(attribute, value);
      } else if (!/^(https?:|mailto:|#|blob:)/i.test(value)) element.removeAttribute(attribute);
    }
    if (element instanceof HTMLAnchorElement && /^https?:/i.test(element.href)) {
      element.rel = 'noopener noreferrer';
      element.target = '_blank';
    }
  }
  return template.innerHTML;
}
export interface RenderResult {
  html: string;
  urls: string[];
  dispose(): void;
}
export async function renderMarkdown(
  text: string,
  documentPath: string,
  fs: WorkspaceFileSystem,
  preferences: Pick<Preferences, 'math' | 'mermaid' | 'wiki' | 'callouts'>,
): Promise<RenderResult> {
  const urls: string[] = [],
    assets = new Map<string, string>(),
    mathRenders = new Map<string, string>(),
    diagrams = new Map<string, string>();
  const mathPlaceholder = (html: string) => {
    const id = `math-${mathRenders.size}`;
    mathRenders.set(id, html);
    return `<span data-math-render="${id}"></span>`;
  };
  const markdown = new Marked({ gfm: true, breaks: false });
  let katex: typeof import('katex').default | undefined;
  if (preferences.math && text.includes('$')) {
    katex = (await import('katex')).default;
    await import('katex/dist/katex.min.css');
  }
  let highlighter: typeof import('highlight.js/lib/common').default | undefined;
  if (/```(?!mermaid)|~~~/.test(text))
    highlighter = (await import('highlight.js/lib/common')).default;
  if (highlighter && /^```(?:julia|jl)\b/m.test(text))
    highlighter.registerLanguage(
      'julia',
      (await import('highlight.js/lib/languages/julia')).default,
    );
  if (highlighter && /^```(?:latex|tex)\b/m.test(text))
    highlighter.registerLanguage(
      'latex',
      (await import('highlight.js/lib/languages/latex')).default,
    );
  markdown.use({
    renderer: {
      image(token: Tokens.Image) {
        const id = `asset-${assets.size}`;
        assets.set(id, token.href);
        return `<figure><img data-asset="${id}" alt="${escapeHTML(token.text)}"/><figcaption>${escapeHTML(token.title ?? '')}</figcaption></figure>`;
      },
      link(token: Tokens.Link) {
        const label = this.parser.parseInline(token.tokens);
        if (/^(https?:|mailto:|#)/i.test(token.href))
          return `<a href="${escapeHTML(token.href)}">${label}</a>`;
        if (/^[a-z]+:|^\/\//i.test(token.href)) return label;
        return `<a href="#" data-local-link="${escapeHTML(token.href)}">${label}</a>`;
      },
      code(token: Tokens.Code) {
        const language = (token.lang ?? '').split(/\s/)[0];
        if (language === 'mermaid' && preferences.mermaid) {
          const id = `diagram-${diagrams.size}`;
          diagrams.set(id, token.text);
          return `<div class="mermaid-block" data-diagram="${id}">Rendering diagram…</div>`;
        }
        if (language === 'latex' && /\\begin\{(?:table|tabular)\}/.test(token.text)) {
          try {
            return renderLatexTable(token.text, (source) =>
              katex
                ? mathPlaceholder(
                    katex.renderToString(source, { throwOnError: false, trust: false }),
                  )
                : escapeHTML(`$${source}$`),
            );
          } catch (error) {
            return `<div class="latex-table-error" role="status">LaTeX table could not be rendered: ${escapeHTML(error instanceof Error ? error.message : String(error))}</div><pre><code class="language-latex">${escapeHTML(token.text)}</code></pre>`;
          }
        }
        const code =
          highlighter && highlighter.getLanguage(language)
            ? highlighter.highlight(token.text, { language }).value
            : escapeHTML(token.text);
        return `<div class="code-block"><div class="code-label">${escapeHTML(language || 'text')}<button type="button" data-copy-code>Copy code</button></div><pre><code class="language-${escapeHTML(language)}">${code}</code></pre></div>`;
      },
      blockquote(token: Tokens.Blockquote) {
        const html = this.parser.parse(token.tokens);
        const match = token.text.match(
          /^\[!(NOTE|INFO|WARNING|TODO|QUESTION|IDEA|HYPOTHESIS|RESULT|IMPORTANT|EXPERIMENT)\]/i,
        );
        return preferences.callouts && match
          ? `<aside class="callout ${match[1].toLowerCase()}"><strong>${match[1]}</strong>${html.replace(/\[![A-Z]+\]/, '')}</aside>`
          : `<blockquote>${html}</blockquote>`;
      },
    },
  });
  if (katex) {
    const math = katex;
    markdown.use({
      extensions: [
        {
          name: 'displayMath',
          level: 'block',
          start: (src) => src.indexOf('$$'),
          tokenizer(src) {
            const m = src.match(/^\$\$\s*\n?([\s\S]+?)\$\$(?:\n|$)/);
            return m ? { type: 'displayMath', raw: m[0], text: m[1] } : undefined;
          },
          renderer(token: Token) {
            return mathPlaceholder(
              math.renderToString((token as Tokens.Generic).text, {
                displayMode: true,
                throwOnError: false,
                trust: false,
                strict: 'warn',
              }),
            );
          },
        },
        {
          name: 'inlineMath',
          level: 'inline',
          start: (src) => src.indexOf('$'),
          tokenizer(src) {
            const m = src.match(/^\$([^$\n]+)\$/);
            return m ? { type: 'inlineMath', raw: m[0], text: m[1] } : undefined;
          },
          renderer(token: Token) {
            return mathPlaceholder(
              math.renderToString((token as Tokens.Generic).text, {
                throwOnError: false,
                trust: false,
              }),
            );
          },
        },
      ],
    });
  }
  markdown.use({
    extensions: [
      {
        name: 'citation',
        level: 'inline',
        start: (src) => src.indexOf('[@'),
        tokenizer(src) {
          const m = src.match(/^\[@([^\]]+)\]/);
          return m ? { type: 'citation', raw: m[0], text: m[1] } : undefined;
        },
        renderer(token: Token) {
          const t = token as Tokens.Generic;
          return `<span class="citation" data-citation="${escapeHTML(t.text)}">${escapeHTML(t.raw)}</span>`;
        },
      },
      ...(preferences.wiki
        ? [
            {
              name: 'wiki',
              level: 'inline' as const,
              start: (src: string) => src.indexOf('[['),
              tokenizer(src: string) {
                const m = src.match(/^\[\[([^\]]+)\]\]/);
                return m ? { type: 'wiki', raw: m[0], text: m[1] } : undefined;
              },
              renderer(token: Token) {
                const t = token as Tokens.Generic;
                const [target, label] = t.text.split('|');
                return `<a href="#" data-wiki="${escapeHTML(target)}">${escapeHTML(label ?? target)}</a>`;
              },
            },
          ]
        : []),
      {
        name: 'footnoteRef',
        level: 'inline',
        start: (src) => src.indexOf('[^'),
        tokenizer(src) {
          const m = src.match(/^\[\^([^\]]+)\](?!:)/);
          return m ? { type: 'footnoteRef', raw: m[0], text: m[1] } : undefined;
        },
        renderer(token: Token) {
          const t = token as Tokens.Generic;
          return `<sup><a href="#footnote-${escapeHTML(t.text)}">${escapeHTML(t.text)}</a></sup>`;
        },
      },
    ],
  });
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const footnotes: string[] = [];
  markdown.use({
    extensions: [
      {
        name: 'footnoteDefinition',
        level: 'block',
        tokenizer(src) {
          const match = src.match(/^\[\^([^\]]+)\]:[ \t]*(.*)(?:\n|$)/);
          return match
            ? { type: 'footnoteDefinition', raw: match[0], key: match[1], text: match[2] }
            : undefined;
        },
        renderer(token: Token) {
          const value = token as Tokens.Generic;
          footnotes.push(
            '<li id="footnote-' +
              escapeHTML(String(value.key)) +
              '"><strong>' +
              escapeHTML(String(value.key)) +
              '</strong> ' +
              escapeHTML(value.text) +
              '</li>',
          );
          return '';
        },
      },
    ],
  });
  const source = text.slice(frontmatter?.[0].length ?? 0);
  const raw = `${frontmatter ? `<details class="frontmatter"><summary>Document properties</summary><pre>${escapeHTML(frontmatter[0])}</pre></details>` : ''}${await markdown.parse(source)}${footnotes.length ? `<section class="footnotes"><hr/><ol>${footnotes.join('')}</ol></section>` : ''}`;
  const template = document.createElement('template');
  template.innerHTML = sanitize(raw);
  for (const element of template.content.querySelectorAll<HTMLElement>('[data-math-render]')) {
    const html = mathRenders.get(element.dataset.mathRender!);
    if (html)
      element.innerHTML = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, mathMl: true },
        FORBID_TAGS: ['script', 'img', 'iframe'],
        FORBID_ATTR: ['href', 'src'],
      });
    element.removeAttribute('data-math-render');
  }
  for (const image of template.content.querySelectorAll<HTMLImageElement>('img[data-asset]')) {
    const reference = assets.get(image.dataset.asset!)!;
    try {
      const blob = await fs.readBlob(resolveAsset(documentPath, reference));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      image.src = url;
      image.dataset.localLink = reference;
    } catch {
      image.replaceWith(
        Object.assign(document.createElement('span'), {
          className: 'asset-unavailable',
          textContent: `Image unavailable: ${reference} (remote resources are blocked)`,
        }),
      );
    }
  }
  if (preferences.mermaid && template.content.querySelector('[data-diagram]')) {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'neutral',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: 50000,
    });
    for (const container of template.content.querySelectorAll<HTMLElement>('[data-diagram]')) {
      try {
        const definition = diagrams.get(container.dataset.diagram!)!;
        if (/(?:https?:|data:|javascript:|@import|url\s*\()/i.test(definition))
          throw new Error('Remote resources and CSS URLs are blocked in diagrams.');
        const { svg } = await mermaid.render(
          `diagram-${crypto.randomUUID()}`,
          diagrams.get(container.dataset.diagram!)!,
        );
        container.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'image', 'script'],
          FORBID_ATTR: ['href', 'xlink:href', 'onload'],
        });
      } catch (error) {
        container.className = 'diagram-error';
        container.textContent = `Diagram could not be rendered: ${String(error).slice(0, 300)}`;
      }
      container.removeAttribute('data-diagram');
    }
  }
  return {
    html: template.innerHTML,
    urls,
    dispose() {
      urls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
export async function standaloneHTML(result: RenderResult, title: string) {
  const template = document.createElement('template');
  template.innerHTML = result.html;
  for (const image of template.content.querySelectorAll<HTMLImageElement>('img[src^="blob:"]')) {
    const blob = await (await fetch(image.src)).blob();
    image.src = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type === CSSRule.FONT_FACE_RULE && result.html.includes('katex')) {
          const face = rule as CSSFontFaceRule;
          const source = face.style.getPropertyValue('src');
          const matches = [...source.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
          const url = matches.find((match) => match[1].endsWith('.woff2'))?.[1];
          if (url) {
            const absolute = new URL(url, sheet.href ?? location.href);
            if (absolute.origin !== location.origin) continue;
            const blob = await (await fetch(absolute)).blob();
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            rules.push(
              '@font-face{font-family:' +
                face.style.getPropertyValue('font-family') +
                ';font-style:' +
                face.style.getPropertyValue('font-style') +
                ';font-weight:' +
                face.style.getPropertyValue('font-weight') +
                ';src:url(' +
                data +
                ') format("woff2")}',
            );
            continue;
          }
        }
        if (rule.type !== CSSRule.FONT_FACE_RULE) rules.push(rule.cssText);
      }
    } catch {
      /* Inaccessible non-app styles are omitted. */
    }
  }
  const css = rules.join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHTML(title)}</title><style>${css}\nbody{background:white;color:#222;margin:40px auto;max-width:850px}.markdown{padding:30px}button{display:none}</style></head><body><article class="markdown">${template.innerHTML}</article></body></html>`;
}
