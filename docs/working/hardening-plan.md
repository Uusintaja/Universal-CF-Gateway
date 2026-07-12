# MVP 验收与硬化计划 - 三类分级 + 独立阶段

> 落盘自第三轮讨论第二节/第三节，回应 Email 真实发送验证不应无限扩展 Phase 范围的问题
> 依据 COLLABORATION_PROTOCOL.md §7.2 工作文档可频改，主跟踪状态+次停车场

---

## 一、问题分级

### P0：必须立即修复（阻塞正确性/数据安全/部署）

* 消息静默丢失（delivered 标记在 acquire 时写导致重试跳过）
* 去重错误导致重复发送或错误跳过（to_send_ids 子集未正确回溯）
* 原始 Payload 被意外破坏（I/O Layer 未按 RawInput 透传）
* Secret 泄漏（PAT/EMAIL_TO/SLACK_WEBHOOK_URL 提交到仓库）
* CI 无法发现类型或配置错误（tsc / dry-run 失败）
* 部署后核心链路无法工作（materialize 抛裸异常、fetch 未读 body 死锁 §0.4b）
* binding 或 migration 缺失导致部署失败（Queue does not exist / KV namespace invalid）
* 明确违反设计不变量（acquire 只读、release success 才写）

示例：本轮 wrangler 3.114 critical out-of-date、Queue/KV 未创建、package-lock 不同步导致 CI 全红，均属 P0，已立即修复。

### P1：Phase 验收前必须处理

* 关键失败路径无行为定义（high→immediate 失败是否 drop: 还是 retry）
* 平台专项测试完全缺失（Email 真实发送仅模拟，无 webhook.site 冒烟）
* 关键 CPU 预算明显超限（Consumer 批 10 条 >10ms）
* Circuit / retry 核心不变量未验证（lane_full / circuit_open 未 TDD）
* 必要日志无法排查主流程（无 trace_id）

### P2：允许延后到统一硬化阶段

* 更完整的 trace 字段（source_trace透传细节）
* 更细致的指标聚合（Analytics Engine 大盘）
* 低价值 API 美化、错误文案优化
* Email 真实收件验证（emailhook.site 真实收到）、MIME 渲染移 DO 内（DO 30s 唯一可重活）

Email 真实发送验证按此归为 P2，不扩 Phase1。

---

## 二、独立最终阶段

在 Phase0-4 主框架完成后，增加：

```
Phase0: 输入管线
Phase1: 高优同步发送
Phase2: DO 协调核心
Phase3: Queues 低优路径
Phase4: 限流与基础可观测性
   ↓
MVP 全链路验收
   ↓
统一硬化清单评估（本文件）
   ↓
修复 P0/P1
   ↓
选择性处理 P2
   ↓
MVP 发布判定
```

每个 Phase 结束只做两件事：
1. 判断问题是否阻塞当前 Phase（P0/P1 阻塞 → 立即修）
2. 将非阻塞问题放入本清单（P2 → 延后）

而不是立即展开新实现范围。

---

## 三、当前硬化清单

| ID | 描述 | 分级 | 来源 Phase | 状态 |
|---|---|---|---|---|
| H-001 | Email 真实发送端到端验证（emailhook.site 真收件） | P2 | Phase1 | 待硬化阶段 |
| H-002 | MIME 渲染移 DO 内评估（DO 30s vs Consumer 10ms） | P2 | Phase1 | 待评估 |
| H-003 | wrangler 4.110 需 Node22，当前本地 Node20 需升级路径 | P2 | Phase1 | 已用 4.72 折中，记录 |
| H-004 | Zod 静态校验 InternalEvent/TransportRequest | P1 | Phase0 | 待 Phase0 补齐 |
| H-005 | Rate Limiting N+1 边界文档化 | P2 | Phase4 | 待 |

更新规则：每轮讨论发现非阻塞项追加此表，不立即改代码。
