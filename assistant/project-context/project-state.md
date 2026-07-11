# Current Project State

## Active Milestone
MVP Phase 0 — 输入侧管线（I/O Layer + Decoder + Router + render）

## Current Step
设计 CI 流程 + 搭建测试基础设施（TDD: 先写测试再写代码）

## Known Issues
- Queue consumer 10ms CPU 紧约束尚未经真实代码验证
- Email MIME 渲染是否需放 DO 未定

## Next Actions
1. 配置 GitHub Actions CI（类型检查 + TDD 测试 + dry-run）
2. 搭项目骨架（src/ + test/ + wrangler.toml + vitest.config.ts）
3. 实现 Phase 0 组件（TDD：测试先行）
