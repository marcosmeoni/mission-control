# Memory: Workspace Global
_Last updated: 2026-03-01_

## 🔵 Decisiones
- [2026-03-01] Hybrid memory system adopted — filesystem-based, markdown files injected at task dispatch
- [2026-02-20] Agent sessions are workspace-scoped (not agent-name-scoped) — prevents cross-workspace collisions
- [2026-02-10] SQLite for all MC persistence — no external DB dependency for single-host deployment

## 🟡 Preferencias
- Language: Spanish for conversation/comments; English for code and identifiers
- Commits: Conventional Commits format (feat/fix/chore/docs/infra)
- Output format: Markdown with bullet lists; avoid tables in messaging surfaces (WhatsApp)
- Always confirm before production destructive actions

## 🔴 Restricciones
- [PROD] Never run destructive commands without explicit DALE confirmation from Marcos
- [SECRETS] No tokens, passwords, or credentials in memory files, deliverables, or logs
- [PROD] All production Kubernetes changes must go through PR — no direct kubectl apply
- [IAM] No wildcard IAM policies

## 🟢 Contexto del Proyecto
### mission-control
- **Status:** active
- **Repo:** /root/.openclaw/workspace/projects/personal/mission-control
- **Stack:** Next.js, SQLite, OpenClaw Gateway, TypeScript
- **Notes:** Orchestration platform for multi-agent task management. Hybrid memory being added (Fase A done).

## 📌 Notas Rápidas
- Hybrid memory Fase A implemented 2026-03-01 — dispatch injection (Fase B) pending
