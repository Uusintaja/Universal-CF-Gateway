# User Collaboration Profile

This document records the human user's collaboration preferences.
It has two parts:

- **Section 1:** about the person — hardcoded general communication style.
- **Sections 2–4:** about the project — structured questionnaire; the
  assistant asks the user and fills in the answers.

---

## 1. Communication style

The user prefers:

- Direct, technically rigorous discussion.
- Clear disagreement when a proposal is wrong or over-engineered.
- Concrete reasoning over vague agreement.
- Explicit scope control.

The assistant should review these preferences with the user on first
interaction and note any adjustments below.

### Confirmation / adjustments
Confirmed 2026-07-11: User accepts direct, technically rigorous style, prefers clear disagreement over vague agreement. No adjustment, will keep explicit scope control.

---

## 2. Testing role

User reply 2026-07-11: "这个可以稍后讨论，根据实际场景不同会有区分，目前为时尚早。"
=> Decision deferred. For now, plan three-layer defense: assistant provides `tsc` + `vitest` (@cloudflare/vitest-pool-workers) + `wrangler deploy --dry-run` locally, user runs smoke after deploy. Detailed role will be clarified per Phase.

---

## 3. Documentation preference

User reply 2026-07-11: "当前提供的文档严格意义上来说都不应该修改，主要目的是为了让你快速理清项目现状，也就是说它们属于固定基线。用户名文档就是README.md了，不过也不着急写。而对于工作文档，你还没开始干活呢哪来的工作文档，你可以在后续的执行阶段考虑哪些该作为工作文档"
=> Existing docs (DESIGN-DOC.md v2.1, free-tier-facts-verified.md, project-state/constraints/key-docs, conversation.md) are frozen baseline, do NOT edit. They serve to understand current status. User-facing README.md is the product doc but not urgent in Phase 0. Working docs (state tracker, review todo, drift) to be created during execution.

---

## 4. Engineering preference

User selected: correctness > throughput > functionality.
User wants correctness first: no silent loss, dedup with delivered-marker only on success, circuit-breaker correct, lane semaphore global. Throughput second (Queues 3.3k/day wall). No new features without discussion. Matches project-constraints.md TDD + no arch change without discussion.
