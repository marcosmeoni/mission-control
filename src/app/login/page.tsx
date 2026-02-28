"use client";

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shield, Lock, User } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Login failed');
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-xs text-mc-text-secondary mb-1 block">Usuario</span>
        <div className="flex items-center gap-2 rounded-md border border-mc-border px-3 py-2 bg-mc-bg">
          <User className="w-4 h-4 text-mc-text-secondary" />
          <input
            className="bg-transparent outline-none w-full text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs text-mc-text-secondary mb-1 block">Contraseña</span>
        <div className="flex items-center gap-2 rounded-md border border-mc-border px-3 py-2 bg-mc-bg">
          <Lock className="w-4 h-4 text-mc-text-secondary" />
          <input
            type="password"
            className="bg-transparent outline-none w-full text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-mc-accent-cyan text-black font-medium py-2 text-sm hover:opacity-90 disabled:opacity-60"
      >
        {loading ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-mc-bg text-mc-text flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-mc-border bg-mc-bg-secondary p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="w-5 h-5 text-mc-accent-cyan" />
          <h1 className="text-lg font-semibold">Mission Control</h1>
        </div>

        <p className="text-sm text-mc-text-secondary mb-6">
          Iniciá sesión para acceder al dashboard.
        </p>

        <Suspense fallback={<p className="text-sm text-mc-text-secondary">Cargando login…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
