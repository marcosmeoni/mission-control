'use client';

import { useParams } from 'next/navigation';

export default function PublicViewPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || '';
  const src = `/api/public/file?token=${encodeURIComponent(token)}`;
  const download = `/api/public/file?token=${encodeURIComponent(token)}&download=1`;
  const downloadPdf = `/api/public/pdf?token=${encodeURIComponent(token)}`;

  return (
    <main className="min-h-screen bg-[#0f1117] text-white flex flex-col">
      <div className="p-2 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="text-xs opacity-70">Shared deliverable</div>
        <div className="flex items-center gap-2">
          <a href={downloadPdf} target="_blank" rel="noopener noreferrer" className="px-3 py-2 text-sm rounded bg-white/10 hover:bg-white/20">
            Descargar PDF
          </a>
          <a href={download} target="_blank" rel="noopener noreferrer" className="px-3 py-2 text-sm rounded bg-white/10 hover:bg-white/20">
            Descargar archivo
          </a>
        </div>
      </div>
      <iframe title="shared-file" src={src} className="w-full flex-1 border-0 bg-white" />
    </main>
  );
}
