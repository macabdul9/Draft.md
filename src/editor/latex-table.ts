type Alignment = 'left' | 'center' | 'right';
type Column = { align: Alignment; left?: boolean; right?: boolean };
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function group(source: string, start: number) {
  while (/\s/.test(source[start] ?? '') && start < source.length) start++;
  if (source[start] !== '{') throw new Error('Expected a braced argument.');
  let depth = 1;
  for (let end = start + 1; end < source.length; end++) {
    if (source[end] === '\\') {
      end++;
      continue;
    }
    if (source[end] === '{') depth++;
    if (source[end] === '}' && --depth === 0)
      return { value: source.slice(start + 1, end), end: end + 1 };
  }
  throw new Error('Unclosed braced argument.');
}

function columns(spec: string): Column[] {
  const result: Column[] = [];
  let border = false;
  for (let i = 0; i < spec.length;) {
    const char = spec[i++];
    if (/\s/.test(char)) continue;
    if (char === '|') {
      border = true;
      if (result.length) result[result.length - 1].right = true;
      continue;
    }
    if (!'lcrpmb'.includes(char))
      throw new Error(
        'Supported column types are l, c, r, p, m, and b, with optional vertical rules.',
      );
    if ('pmb'.includes(char)) i = group(spec, i).end;
    result.push({ align: char === 'c' ? 'center' : char === 'r' ? 'right' : 'left', left: border });
    border = false;
    if (result.length > 40) throw new Error('Tables support up to 40 columns.');
  }
  if (!result.length) throw new Error('The table needs at least one column.');
  return result;
}

function inline(source: string, math: (source: string) => string, depth = 0): string {
  if (depth > 20) throw new Error('Cell formatting is nested too deeply.');
  let html = '';
  for (let i = 0; i < source.length;) {
    const char = source[i++];
    if (char === '$') {
      let end = i;
      while (end < source.length && (source[end] !== '$' || source[end - 1] === '\\')) end++;
      if (end === source.length) throw new Error('Unclosed math expression.');
      html += math(source.slice(i, end));
      i = end + 1;
      continue;
    }
    if (char === '{') {
      const arg = group(source, i - 1);
      html += inline(arg.value, math, depth + 1);
      i = arg.end;
      continue;
    }
    if (char === '}') throw new Error('Unexpected closing brace.');
    if (char !== '\\') {
      html += escape(char);
      continue;
    }
    const command = source.slice(i).match(/^[A-Za-z]+/)?.[0];
    if (!command) {
      const literal = source[i++];
      if (!literal || !'&%_$#{}\\ '.includes(literal))
        throw new Error('Unsupported escaped character.');
      html += escape(literal);
      continue;
    }
    i += command.length;
    const tags: Record<string, string> = {
      textbf: 'strong',
      textit: 'em',
      emph: 'em',
      texttt: 'code',
      underline: 'u',
      textrm: 'span',
      textnormal: 'span',
    };
    if (tags[command]) {
      const arg = group(source, i);
      i = arg.end;
      html += `<${tags[command]}>${inline(arg.value, math, depth + 1)}</${tags[command]}>`;
    } else if (command === 'LaTeX') html += 'LaTeX';
    else if (command === 'TeX') html += 'TeX';
    else if (command === 'newline') html += '<br/>';
    else throw new Error(`Unsupported command: \\${command}.`);
  }
  return html.trim();
}

/** A deliberately bounded table subset; never executes TeX or resolves external resources. */
export function renderLatexTable(source: string, math: (source: string) => string): string {
  if (source.length > 100000) throw new Error('LaTeX table blocks must be under 100 KB.');
  // Strip comments without treating escaped percent signs as comments.
  source = source
    .replace(/\\[\s\S]|%[^\n]*/g, (match) => (match.startsWith('%') ? '' : match))
    .trim();
  const wrapper = source.match(/^\\begin\{table\}(?:\[[^\]]*\])?\s*/);
  if (wrapper) {
    if (!/\\end\{table\}\s*$/.test(source)) throw new Error('Missing \\end{table}.');
    source = source
      .slice(wrapper[0].length)
      .replace(/\\end\{table\}\s*$/, '')
      .trim();
  }
  let caption = '';
  source = source.replace(/\\centering\b/g, '');
  for (const command of ['caption', 'label']) {
    const match = new RegExp(`\\\\${command}\\b`).exec(source);
    if (!match) continue;
    const arg = group(source, match.index + match[0].length);
    if (command === 'caption') caption = inline(arg.value, math);
    source = source.slice(0, match.index) + source.slice(arg.end);
  }
  source = source.trim();
  const begin = source.match(/^\\begin\{tabular\}(?:\[[tbc]\])?\s*/);
  if (!begin || !/\\end\{tabular\}\s*$/.test(source))
    throw new Error('Use one table/tabular environment inside this latex block.');
  const spec = group(source, begin[0].length);
  const cols = columns(spec.value);
  const body = source.slice(spec.end).replace(/\\end\{tabular\}\s*$/, '');
  const rows: { cells: string[]; rules: string[] }[] = [];
  let cells: string[] = [],
    cell = '',
    depth = 0,
    inMath = false,
    pending: string[] = [];
  const flush = () => {
    if (!cells.length && !cell.trim()) return;
    rows.push({ cells: [...cells, cell.trim()], rules: pending });
    cells = [];
    cell = '';
    pending = [];
    if (rows.length > 500) throw new Error('Tables support up to 500 rows.');
  };
  for (let i = 0; i < body.length;) {
    const char = body[i];
    if (char === '\\') {
      if (!depth && !inMath && body[i + 1] === '\\') {
        flush();
        i += 2;
        continue;
      }
      const rule =
        !depth && !inMath && body.slice(i).match(/^\\(toprule|midrule|bottomrule|hline)\b/);
      if (rule) {
        if (cells.length || cell.trim()) throw new Error('Add \\\\ before a table rule.');
        pending.push(rule[1]);
        i += rule[0].length;
        continue;
      }
      cell += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (char === '$') inMath = !inMath;
    if (!inMath && char === '{') depth++;
    if (!inMath && char === '}') depth--;
    if (depth < 0) throw new Error('Unexpected closing brace.');
    if (char === '&' && !depth && !inMath) {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
    i++;
  }
  if (depth || inMath) throw new Error('Unclosed cell formatting or math.');
  flush();
  if (!rows.length) throw new Error('The table needs at least one row.');
  const html = rows
    .map((row) => {
      let column = 0;
      const cells = row.cells.map((text) => {
        let span = 1,
          col = cols[column];
        if (text.startsWith('\\multicolumn')) {
          const count = group(text, '\\multicolumn'.length);
          const align = group(text, count.end);
          const content = group(text, align.end);
          span = Number(count.value);
          if (!Number.isInteger(span) || span < 1 || text.slice(content.end).trim())
            throw new Error('Invalid multicolumn cell.');
          const override = columns(align.value);
          if (override.length !== 1) throw new Error('Multicolumn needs one alignment.');
          col = override[0];
          text = content.value;
        }
        if (!col || column + span > cols.length)
          throw new Error('A row has more cells than the column specification.');
        column += span;
        return `<td colspan="${span}" class="latex-align-${col.align}${col.left ? ' latex-border-left' : ''}${col.right ? ' latex-border-right' : ''}">${inline(text, math) || '&nbsp;'}</td>`;
      });
      while (column < cols.length) {
        const col = cols[column++];
        cells.push(
          `<td class="latex-align-${col.align}${col.left ? ' latex-border-left' : ''}${col.right ? ' latex-border-right' : ''}">&nbsp;</td>`,
        );
      }
      return `<tr class="${row.rules.map((rule) => `latex-rule-${rule}`).join(' ')}">${cells.join('')}</tr>`;
    })
    .join('');
  return `<div class="latex-table-wrap"><table class="latex-table${pending.some((rule) => rule === 'bottomrule' || rule === 'hline') ? ' latex-bottom-rule' : ''}">${caption ? `<caption>${caption}</caption>` : ''}<tbody>${html}</tbody></table></div>`;
}
