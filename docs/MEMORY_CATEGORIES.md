# Memory Categories

This document defines the four canonical memory categories used in Mission Control's hybrid memory system. Every memory entry should belong to exactly one of these categories.

---

## 🔵 Decisiones (Decisions)

**What it captures:** Significant choices made — architectural, operational, or process-level — along with the rationale behind them.

**When to write:**
- An architectural decision was finalized (e.g., "we use Terraform over Pulumi")
- A process was changed after a post-mortem
- A design tradeoff was made consciously

**Format:**
```
- [YYYY-MM-DD] {Decision} — {Why}
```

**Examples:**
```
- [2026-01-15] Use SQLite for local persistence — avoids infra overhead for single-host MVP
- [2026-02-03] All K8s changes must go through PR; no kubectl apply in prod — post-incident policy
- [2026-02-20] Agent sessions are workspace-scoped, not agent-name-scoped — prevents cross-workspace collisions
```

**Retention:** Long-lived. Only remove if the decision has been reversed or is no longer relevant.

---

## 🟡 Preferencias (Preferences)

**What it captures:** How an agent or workspace prefers to operate. Style, tooling, output format, communication tone, defaults.

**When to write:**
- A user corrects an agent's output style ("use bullet lists, not tables in WhatsApp")
- A tool preference is established ("prefer `rg` over `grep`")
- An output convention is agreed upon

**Format:**
```
- {Category}: {Preference}
```

**Examples:**
```
- Output format: Markdown with bullet lists; avoid tables in messaging surfaces
- Language: Spanish for comments and commit messages; English for code
- Commits: Conventional Commits format (feat/fix/chore/docs)
- PR descriptions: Always include a "What changed" and "Why" section
```

**Retention:** Medium-lived. Review when preferences seem outdated.

---

## 🔴 Restricciones (Restrictions)

**What it captures:** Hard limits that must not be violated. These take priority over everything else.

**When to write:**
- A production guardrail was established
- A known failure mode was discovered
- A compliance/security constraint applies
- An environment is off-limits for certain operations

**Format:**
```
- [SCOPE] {Restriction} — {Consequence or source}
```

**Examples:**
```
- [PROD] Never run `kubectl delete` without explicit DALE confirmation — irreversible
- [IAM] Do not create wildcard IAM policies — security audit requirement
- [COST] All new cloud resources need a cost tag (project/env/team) — FinOps policy
- [API] MC_API_TOKEN must never be logged or included in deliverable files
```

**Retention:** Long-lived. Restrictions rarely expire; mark as `[LIFTED YYYY-MM-DD]` if removed.

---

## 🟢 Contexto del Proyecto (Project Context)

**What it captures:** Active project state — what's in flight, tech stack, key contacts, repo links, current status.

**When to write:**
- A new project is started
- A project changes status (active → paused → done)
- Key technical decisions about a project are made
- A new team member or agent is assigned

**Format:**
```markdown
### {Project Name}
- **Status:** active | paused | done
- **Owner:** {agent or person}
- **Repo:** {url or path}
- **Stack:** {technologies}
- **Last action:** [YYYY-MM-DD] {what happened}
- **Notes:** {anything relevant for the next task}
```

**Examples:**
```markdown
### spin-k8s-migration
- **Status:** active
- **Owner:** spec-k8s agent
- **Repo:** github.com/naranjax/spin-infra
- **Stack:** EKS, Terraform, Helm, ArgoCD
- **Last action:** [2026-02-18] Node group migrated to Karpenter
- **Notes:** Still 3 deployments using HPA v1 — need upgrading before next release

### cost-dashboard
- **Status:** paused
- **Owner:** spec-finops agent
- **Repo:** github.com/naranjax/cost-tools
- **Stack:** Python, OCI SDK, Grafana
- **Last action:** [2026-01-30] Initial data pipeline done; blocked on OCI billing API access
- **Notes:** Resume after IT tickets #4412 resolved
```

**Retention:** Active while project is live. Archive (move to `## 🗄️ Archivados`) when done.

---

## 📌 Notas Rápidas (Quick Notes)

**What it captures:** Short-lived, ephemeral context that doesn't fit the above categories. Meant to be cleared on next memory review.

**When to write:**
- Something came up mid-task that might matter next time
- A temporary workaround is in place
- A follow-up question needs answering

**Examples:**
```
- TODO: Check if the OCI budget alert is still active after the account migration
- TEMP: prod-db-backup is running on cron manually until Terraform module is fixed
- FYI: Marcos asked for all K8s tasks to go through him first this sprint
```

**Retention:** Short-lived. Review and promote to a proper category or delete.
