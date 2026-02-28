import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';

const FILE_PATH = '/root/.openclaw/workspace/projects/personal/mission-control/data/router-rules.json';

const DEFAULT_RULES = {
  rules: [
    { key: 'spec-git', patterns: ['repo', 'repository', 'git', 'github', 'gitlab', 'branch', 'commit', 'mr', 'pr', 'changelog', 'tag release'] },
    { key: 'spec-iac', patterns: ['iac', 'terraform', 'terragrunt', 'iam', 'vpc', 'policy', 'módulo', 'modulo', 'repo iac', 'infra as code'] },
    { key: 'spec-k8s', patterns: ['k8s', 'kubernetes', 'eks', 'oke', 'aks', 'ingress', 'hpa', 'karpenter', 'helm'] },
    { key: 'spec-ci', patterns: ['pipeline', 'github actions', 'gitlab ci', 'bitbucket', 'cicd', 'ci/'] },
    { key: 'spec-python', patterns: ['python', 'script', 'automation', 'bot', 'parser'] },
    { key: 'spec-ansible', patterns: ['ansible', 'playbook', 'hardening', 'inventory'] },
    { key: 'spec-observability', patterns: ['slo', 'sli', 'grafana', 'prometheus', 'alert', 'observab'] },
    { key: 'spec-finops', patterns: ['cost', 'finops', 'spend', 'billing', 'rightsiz', 'oci', 'reporte de costos', 'cost report', 'informe de costos'] },
    { key: 'spec-secops-cloud', patterns: ['security', 'secrets', 'least privilege', 'posture', 'compliance'] },
    { key: 'spec-release-manager', patterns: ['release', 'deploy window', 'change management', 'cutover'] },
    { key: 'spec-incident-commander', patterns: ['incident', 'sev1', 'sev2', 'sev3', 'outage', 'rca', 'postmortem'] },
    { key: 'spec-platform-engineering', patterns: ['golden path', 'platform', 'scaffold', 'template'] },
    { key: 'spec-runbook-automation', patterns: ['runbook', 'automation workflow', 'operational procedure'] },
    { key: 'spec-dr-bcp', patterns: ['dr', 'bcp', 'backup', 'restore', 'rto', 'rpo'] },
  ],
};

export async function GET() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      return NextResponse.json(JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')));
    }
    return NextResponse.json(DEFAULT_RULES);
  } catch {
    return NextResponse.json(DEFAULT_RULES);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!Array.isArray(body?.rules)) {
      return NextResponse.json({ error: 'rules must be an array' }, { status: 400 });
    }

    fs.mkdirSync('/root/.openclaw/workspace/projects/personal/mission-control/data', { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify({ rules: body.rules }, null, 2));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save router rules' }, { status: 500 });
  }
}
