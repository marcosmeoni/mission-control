'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function EditorInner() {
  const search = useSearchParams();
  const pathParam = search.get('path') || '';

  const [content, setContent] = useState('');
  const [path, setPath] = useState(pathParam);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!pathParam) {
      setLoading(false);
      return;
    }

    fetch(`/api/files/text?path=${encodeURIComponent(pathParam)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.content !== undefined) {
          setContent(d.content);
          setPath(d.path || pathParam);
        } else {
          setMsg(d?.error || 'No se pudo abrir archivo');
        }
      })
      .catch(() => setMsg('No se pudo abrir archivo'))
      .finally(() => setLoading(false));
  }, [pathParam]);

  const save = async () => {
    setMsg('Guardando...');
    const res = await fetch('/api/files/text', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(data?.error || 'Error al guardar');
    else setMsg('Guardado ✅');
  };

  return (
    <main className="min-h-screen bg-mc-bg text-mc-text p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Editor</h1>
          <button onClick={save} className="px-3 py-2 rounded bg-mc-accent text-mc-bg text-sm">Guardar</button>
        </div>

        <div className="text-xs text-mc-text-secondary break-all">{path || '(sin path)'}</div>
        {msg && <div className="text-xs text-mc-text-secondary">{msg}</div>}

        {loading ? (
          <div className="text-sm text-mc-text-secondary">Cargando...</div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[75vh] bg-mc-bg-secondary border border-mc-border rounded p-3 font-mono text-xs focus:outline-none focus:border-mc-accent"
            spellCheck={false}
          />
        )}
      </div>
    </main>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-mc-bg text-mc-text p-4">Cargando editor...</main>}>
      <EditorInner />
    </Suspense>
  );
}
