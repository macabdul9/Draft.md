import { useEffect, useState } from 'preact/hooks';
import type { WorkspaceFileSystem } from '../filesystem/adapter';
import { download } from '../filesystem/archive';
import { Download } from 'lucide-preact';
export default function AssetViewer({ fs, path }: { fs: WorkspaceFileSystem; path: string }) {
  const [url, setURL] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true,
      url = '';
    void fs
      .readBlob(path)
      .then((blob) => {
        url = URL.createObjectURL(
          new Blob([blob], {
            type: /\.pdf$/i.test(path)
              ? 'application/pdf'
              : blob.type || `image/${path.split('.').at(-1)?.replace('jpg', 'jpeg')}`,
          }),
        );
        if (alive) setURL(url);
        else URL.revokeObjectURL(url);
      })
      .catch((error) => setError(String(error)));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fs, path]);
  return (
    <div class="asset-viewer">
      {error ? (
        <p role="alert">{error}</p>
      ) : url ? (
        /\.pdf$/i.test(path) ? (
          <iframe title={`PDF: ${path}`} src={url} sandbox="allow-same-origin allow-scripts" />
        ) : (
          <img src={url} alt={path} />
        )
      ) : (
        <p>Opening asset…</p>
      )}
      <button
        onClick={() => {
          void fs.readBlob(path).then((blob) => download(blob, path.split('/').at(-1)!));
        }}
      >
        <Download size={15} />
        Download original
      </button>
    </div>
  );
}
