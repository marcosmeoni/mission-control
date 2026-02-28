import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { spawn } from 'child_process';

function updateEnvPassword(filePath: string, newPassword: string) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let found = false;

  const updated = lines.map((line) => {
    if (line.startsWith('MC_BASIC_AUTH_PASS=')) {
      found = true;
      return `MC_BASIC_AUTH_PASS=${newPassword}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`MC_BASIC_AUTH_PASS=${newPassword}`);
  }

  fs.writeFileSync(filePath, updated.join('\n'));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');

    const currentEnvPassword = process.env.MC_BASIC_AUTH_PASS;
    if (!currentEnvPassword) {
      return NextResponse.json({ error: 'Basic auth is not configured' }, { status: 503 });
    }

    if (currentPassword !== currentEnvPassword) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }

    const envFiles = [
      '/root/.openclaw/workspace/projects/personal/mission-control/.env.local',
      '/root/.openclaw/workspace/projects/personal/mission-control/.env.production.local',
    ];

    for (const file of envFiles) {
      updateEnvPassword(file, newPassword);
    }

    // Apply immediately by restarting the service in background
    const cmd = 'sleep 1; systemctl restart mission-control';
    const child = spawn('bash', ['-lc', cmd], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return NextResponse.json({ ok: true, message: 'Password updated. Service restarting...' });
  } catch {
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
