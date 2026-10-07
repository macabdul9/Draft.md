export interface Knowledge {
  tags: string[];
  links: string[];
}
/** Rebuildable metadata only. Code, headings and inline code cannot become tags. */
export function knowledge(text: string): Knowledge {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const tags: string[] = [];
  if (frontmatter) {
    const field = frontmatter[1].match(/tags:\s*\[([^\]]+)\]|tags:\s*\n((?:\s+-[^\n]+\n?)+)/);
    if (field)
      tags.push(
        ...(field[1] ?? field[2])
          .replace(/\s+-\s*/g, ',')
          .split(',')
          .map((tag) => tag.trim().replace(/["']/g, ''))
          .filter(Boolean),
      );
  }
  const source = text
    .slice(frontmatter?.[0].length ?? 0)
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^#{1,6}\s.*$/gm, '');
  tags.push(...Array.from(source.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu), (match) => match[1]));
  const links = Array.from(source.matchAll(/\[\[([^\]#|]+)(?:[^\]]*)\]\]/g), (match) =>
    match[1].toLocaleLowerCase(),
  );
  return { tags: [...new Set(tags)], links: [...new Set(links)] };
}
