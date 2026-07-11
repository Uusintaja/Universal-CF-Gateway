# Project Constraints

## Frozen Baselines
- DESIGN-DOC.md v2.1（固定基准，修改需经讨论）
- free-tier-facts-verified.md（已完成的工作文档，数据已验证）

## Coding Conventions
- TypeScript 严格模式
- 每个组件配单元测试（Vitest + @cloudflare/vitest-pool-workers）
- 部署前必须过 tsc + 全绿测试
- CI: GitHub Actions

## Process Rules
- 必须采用 TDD：测试先于实现，红 → 绿 → 重构
- GitHub Actions CI 全绿才允许合并/部署
- 无架构变化不经讨论直接改代码
- 无新依赖不经批准
- 所有 spike/边界测试的结论必须更新到项目文档后才算完成
