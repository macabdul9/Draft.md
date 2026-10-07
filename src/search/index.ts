export interface SearchDocument {
  path: string;
  text: string;
}
export interface SearchResult {
  path: string;
  line: number;
  snippet: string;
  score: number;
}
export function searchDocuments(
  documents: Iterable<SearchDocument>,
  query: string,
  filenamesOnly = false,
): SearchResult[] {
  query = query.toLocaleLowerCase().trim();
  if (!query) return [];
  const results: SearchResult[] = [];
  for (const doc of documents) {
    const lowerPath = doc.path.toLocaleLowerCase();
    let position = 0;
    for (const char of query) {
      position = lowerPath.indexOf(char, position);
      if (position < 0) break;
      position++;
    }
    const filename = lowerPath.includes(query) || (filenamesOnly && position >= 0);
    if (filename)
      results.push({
        path: doc.path,
        line: 1,
        snippet: doc.path,
        score: lowerPath.includes(query) ? 0 : 1,
      });
    if (!filenamesOnly) {
      const lines = doc.text.split('\n');
      for (let i = 0; i < lines.length; i++)
        if (lines[i].toLocaleLowerCase().includes(query)) {
          results.push({
            path: doc.path,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 180),
            score: 2,
          });
          if (results.length >= 300) break;
        }
    }
  }
  return results.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path)).slice(0, 100);
}
