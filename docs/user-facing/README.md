# Universal CF Gateway - User Facing (Placeholder)

> 按 §7.1 用户面应短，快速开始、如何跑、去哪找文档、高层限制
> 暂不急写，Phase 0/1 以骨架为主，此为占位

## Quick Start

```bash
npm install --legacy-peer-deps
npx wrangler dev
# POST
curl -X POST http://localhost:8787/webhook/github-ci -H "Content-Type: application/json" -d '{"title":"test","severity":"high"}'
```

## Where to find docs

* 架构固定基线：`docs/historical/project_review/DESIGN-DOC.md v2.1`
* 协作协议：`assistant/COLLABORATION_PROTOCOL.md`
* 工作文档：`docs/working/hardening-plan.md` / `doc-system.md`
* 固定基线关闭：`docs/fixed/phase0-closing-v1.md` / `phase1-closing-v1.md`

## Limitations

* Phase1 仅高优同步，不含 DO/Queues/KV，低优需 Phase3
* Free 层 Queues 10k ops/天 ≈ 3.3k 低优/天 第一墙
* DO 30s 唯一可重活，stateless Worker 按 10ms 设计
