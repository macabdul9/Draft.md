export type TableAction = 'add-row' | 'delete-row' | 'add-column' | 'delete-column' | 'align';
export function editTable(
  text: string,
  lineNumber: number,
  action: TableAction,
): { from: number; to: number; insert: string } | null {
  const lines = text.split('\n');
  let start = lineNumber - 1,
    end = start;
  if (!lines[start]?.trim().startsWith('|')) return null;
  while (start > 0 && lines[start - 1].trim().startsWith('|')) start--;
  while (end + 1 < lines.length && lines[end + 1].trim().startsWith('|')) end++;
  const rows = lines.slice(start, end + 1).map((line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim()),
  );
  if (rows.length < 2 || !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const columns = rows[0].length;
  for (const row of rows) while (row.length < columns) row.push('');
  if (action === 'add-row')
    rows.splice(Math.max(2, lineNumber - start), 0, Array(columns).fill(''));
  if (action === 'delete-row') {
    const row = lineNumber - 1 - start;
    if (row < 2 || rows.length <= 3) return null;
    rows.splice(row, 1);
  }
  if (action === 'add-column') rows.forEach((row, i) => row.push(i === 1 ? '---' : ''));
  if (action === 'delete-column') {
    if (columns <= 1) return null;
    rows.forEach((row) => row.pop());
  }
  if (action === 'align')
    rows[1] = rows[1].map((cell) =>
      cell.startsWith(':') && cell.endsWith(':') ? '---:' : cell.endsWith(':') ? '---' : ':---:',
    );
  const from = lines.slice(0, start).reduce((length, line) => length + line.length + 1, 0);
  const to = from + lines.slice(start, end + 1).join('\n').length;
  return { from, to, insert: rows.map((row) => `| ${row.join(' | ')} |`).join('\n') };
}
