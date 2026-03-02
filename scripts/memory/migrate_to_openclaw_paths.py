#!/usr/bin/env python3
from pathlib import Path
import shutil

mc = Path('/root/.openclaw/workspace/projects/personal/mission-control/data/memory')
oc = Path('/root/.openclaw/workspace')

workspace_src = mc / 'workspace.md'
workspace_dst = oc / 'MEMORY.md'

agents_src = mc / 'agents'
agents_dst = oc / 'agents'

projects_src = mc / 'projects'
projects_dst = oc / 'memory' / 'context' / 'projects'

projects_dst.mkdir(parents=True, exist_ok=True)
agents_dst.mkdir(parents=True, exist_ok=True)

if workspace_src.exists() and not workspace_dst.exists():
    shutil.copy2(workspace_src, workspace_dst)
    print('copied workspace.md -> MEMORY.md')

# Convert legacy agents/<id>.md into agents/<id>/MEMORY.md
if agents_src.exists():
    for f in agents_src.glob('*.md'):
        aid = f.stem
        d = agents_dst / aid
        d.mkdir(parents=True, exist_ok=True)
        target = d / 'MEMORY.md'
        if not target.exists():
            shutil.copy2(f, target)
            print(f'copied agent {f.name} -> agents/{aid}/MEMORY.md')

# Copy project memory files
if projects_src.exists():
    for f in projects_src.glob('*.md'):
        target = projects_dst / f.name
        if not target.exists():
            shutil.copy2(f, target)
            print(f'copied project {f.name} -> memory/context/projects/{f.name}')

print('done')
