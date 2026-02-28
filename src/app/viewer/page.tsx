'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function ViewerInner() {
  const search = useSearchParams();
  const router = useRouter();
  const path = search.get('path') || '';
  const downloadPdf = `/api/files/pdf?path=${encodeURIComponent(path)}`;

  return (
    <main className="min-h-screen bg-mc-bg text-mc-text flex flex-col">
      <div className="p-2 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2">
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
          className="px-3 py-2 rounded bg-mc-bg border border-mc-border text-sm"
        >
          ← Volver
        </button>
        <div className="text-xs text-mc-text-secondary truncate max-w-[50vw]">{path}</div>
        <a href={downloadPdf} className="px-3 py-2 rounded bg-mc-bg border border-mc-border text-sm whitespace-nowrap">
          Descargar PDF
        </a>
      </div>
      <iframe
        title="preview"
        src={`/api/files/preview?path=${encodeURIComponent(path)}`}
        className="w-full flex-1 border-0"
      />
    </main>
  );
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-mc-bg text-mc-text p-4">Cargando vista...</main>}>
      <ViewerInner />
    </Suspense>
  );
}
