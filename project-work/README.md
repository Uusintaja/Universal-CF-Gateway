# Project Work Documentation

本目录是 Universal-CF-Gateway 的可变工作文档区。

## 五类文档映射

| 协议分类 | 位置 | 规则 |
|---|---|---|
| User-facing | `user-facing/` | 指向面向用户的正式文档，不复制 README 内容 |
| Working | 本目录根层 | 经常修改的状态、审查、验收和硬化文档，保持易发现 |
| Fixed baseline | `fixed/` | 只保存索引和指针，不复制或修改固定基线 |
| Historical | `historical/` | 只保存历史资料索引，不作为当前事实来源 |
| Assistant-facing | `assistant-facing/` | 指向协作协议、用户偏好和 onboarding 文档 |

## 工作文档

- `hardening-register.md`：P0/P1/P2 硬化事项登记。
- `review-tracking.md`：当前讨论、批准执行项和延期项。
- `phase-acceptance.md`：各 Phase 的功能验收和平台验证状态。

## 更新规则

1. 固定基线文档不因日常进度而修改。
2. 讨论阶段只分析、分级并记录批准事项。
3. 执行阶段只实现已批准的范围。
4. P0/P1 问题按协议判断是否阻塞当前阶段。
5. P2 问题默认进入 MVP 验收与硬化阶段，不自动扩大当前 Phase。
6. 工作文档记录证据、提交号和测试结果，不充当 changelog。
