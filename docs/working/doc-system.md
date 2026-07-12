# 文档体系 - 按 COLLABORATION_PROTOCOL.md §7

> 本文件属 working 文档，可频改，主跟踪文档分类，次停车场吸纳超范围想法
> 创建于第三轮讨论第五节执行，按用户要求新建根 docs/，与固定基线隔离

## 7.1 用户面文档
* 路径：`docs/user-facing/`
* 职责：快速开始、如何跑、去哪找文档、高层限制，短
* 当前：根 `README.md` 仍是用户面入口，暂不急写，Phase0/1 结束后按需同步

## 7.2 工作文档
* 路径：`docs/working/`
* 职责：可频繁编辑，主跟踪项目状态、review 项、drift、过程陷阱；次作为停车场吸纳执行中冒出的超范围想法但不直接扩 scope
* 现有：
  * `hardening-plan.md` - P0/P1/P2 分级 + MVP Acceptance & Hardening 流程（本轮落盘）
  * `project-state-tracker.md` - 待建，跟踪 MVP Phase 进度
  * `review-todo.md` - 待建，Code review 环
  * `drift.md` - 待建，文档与源码不一致记录
  * `pitfall.md` - 待建，助手过程陷阱

## 7.3 固定基线文档
* 路径：`docs/fixed/` + `assistant/project-context/` + `docs/historical/project_review/` 中 DESIGN-DOC 等
* 职责：阶段边界创建，版本化，仅当事实性错误才改，不按轮
* 规则：
  * Stage-opening：定义本阶段做什么、为什么、怎么做
  * Stage-closing：总结达成、偏差、是否可关，必须版本化保留时间线
* 现状：
  * `assistant/project-context/project-state.md` / `project-constraints.md` / `project-key-docs.md` - P0 已读，固定基线只读不写
  * `docs/historical/project_review/DESIGN-DOC.md v2.1` - 架构固定基线
  * `docs/fixed/phase0-closing-v1.md` / `phase1-closing-v1.md` - 待建

## 7.4 历史文档
* 路径：`docs/historical/`
* 职责：非当前真理，保留上下文，不编辑除非加 legacy notice
* 现状：已将根 `project_review/` 移入 `docs/historical/project_review/`，含 `conversation.md` / `free-tier-facts-verified.md`

## 7.5 助手面文档
* 路径：根 `assistant/` - 保留，只读不写
* 职责：描述协作协议与画像，不描述项目行为，更新仅当协议真变
* 包含：`COLLABORATION_PROTOCOL.md` / `USER_PROFILE.md` / `ASSISTANT_ONBOARDING.md` / `PAT_GUIDE.md`
* 根新建 `docs/` 不再重复创建 assistant-facing，避免混淆

## 更新纪律
* 固定基线 vs 工作文档边界：按 §8 真理层级，源码 > 配置 > README > 架构 > 发布校验 > 历史
* 发现漂移：读源码第一，记 drift 条目，讨论轮提议决议，执行轮才改范围外文件
