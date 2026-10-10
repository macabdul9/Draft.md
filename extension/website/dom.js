export const siteSelectors = {
  chatgpt: {
    editor: '#prompt-textarea, textarea[data-testid="prompt-textarea"]',
    send: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    stop: 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]',
    answer: '[data-message-author-role="assistant"] .markdown',
  },
  claude: {
    editor: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"][role="textbox"]',
    send: 'button[aria-label="Send message"], button[aria-label="Send Message"], button[data-testid="send-button"]',
    stop: 'button[aria-label="Stop response"], button[aria-label="Stop Response"], button[aria-label="Stop generating"]',
    answer: '[data-testid="assistant-message"], .font-claude-response',
  },
};
export function toMarkdown(root) {
  const clone = root.cloneNode(true);
  clone
    .querySelectorAll(
      'script,style,button,svg,[data-testid*="thinking"],[data-testid*="reasoning"],[aria-hidden="true"]',
    )
    .forEach((node) => node.remove());
  function walk(node) {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map(walk).join('');
    if (tag === 'pre') {
      const code = node.querySelector('code') || node;
      const language =
        [...code.classList].find((name) => name.startsWith('language-'))?.slice(9) || '';
      return '\n\n```' + language + '\n' + code.textContent.replace(/\n$/, '') + '\n```\n\n';
    }
    if (tag === 'code') return '`' + node.textContent + '`';
    if (/^h[1-6]$/.test(tag))
      return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + children().trim() + '\n\n';
    if (tag === 'br') return '\n';
    if (tag === 'p') return children() + '\n\n';
    if (tag === 'strong' || tag === 'b') return '**' + children() + '**';
    if (tag === 'em' || tag === 'i') return '*' + children() + '*';
    if (tag === 'del' || tag === 's') return '~~' + children() + '~~';
    if (tag === 'input') return '';
    if (tag === 'li') {
      const box = node.querySelector('input[type="checkbox"]');
      const prefix = box
        ? '- [' + (box.checked ? 'x' : ' ') + '] '
        : node.parentElement?.tagName === 'OL'
          ? [...node.parentElement.children].indexOf(node) + 1 + '. '
          : '- ';
      return (
        prefix +
        children()
          .trim()
          .replace(/\n{2,}/g, '\n') +
        '\n'
      );
    }
    if (tag === 'ul' || tag === 'ol') return '\n' + children() + '\n';
    if (tag === 'blockquote')
      return (
        '\n' +
        children()
          .trim()
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n') +
        '\n\n'
      );
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      return /^(https?:|\/|#)/.test(href) ? '[' + children() + '](' + href + ')' : children();
    }
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map(
        (row) =>
          '| ' +
          [...row.children]
            .map((cell) => walk(cell).trim().replace(/\n/g, ' ').replace(/\|/g, '\\|'))
            .join(' | ') +
          ' |',
      );
      if (rows.length)
        rows.splice(
          1,
          0,
          '| ' + [...node.querySelector('tr').children].map(() => '---').join(' | ') + ' |',
        );
      return '\n\n' + rows.join('\n') + '\n\n';
    }
    return children();
  }
  let result = walk(clone)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (result.startsWith('```markdown\n'))
    result = result
      .slice(12)
      .replace(/\n```$/, '')
      .trim();
  return result;
}
