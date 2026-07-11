ASSISTANT:
让我检查一下当前文档的状态，以确切查看需要完成的内容。

Facts 文件已经修好了（行 15-17 正确）。DESIGN-DOC.md 还有 3 处旧数据需要修：行 92（CPU 表格）、行 627（高优路径表）、行 946（changelog）。加上标题需要从 v2.0 改为 v2.1，以及核心一句话需要更新。逐个修。

现在修复第92行 —— §0.4 事实表格中的 Consumer CPU 行。

现在修复第 627 行 — §4.8 high-priority 路径表。

现在添加 v2.1 更新日志条目。

现在请更新 §0.4b V8 sandbox traps 部分，将关于 burst/penalty 的新发现以及 DO 30s 的发现包含进去。

现在进行最后的回归测试。

全部修正完成。所有旧数据已清除（残留 0），新发现全部落位。

## v2.1 修订完成总结

### Spike #7 纠正了 v2.0 的一个错误结论

| 项目 | v2.0（错误）| v2.1（纠正）|
|---|---|---|
| Queue Consumer CPU | "实测 ~2000ms，大幅放宽 batch" | **10ms**（~2000ms 是 stateless Worker 的 burst 天花板，非持续限额；burst 后惩罚降至 50ms）|

### Spike #7 发现的三个新事实

| 发现 | 数据 | 设计影响 |
|---|---|---|
| **CPU burst/惩罚级联** | 首次超 CPU 允许 burst 到 ~2s，但一旦 exceededCpu → 后续骤降至 10-50ms | **所有 stateless Worker（fetch/queue/cron）设计按 10ms，绝不依赖 burst** |
| **DO 有 30s CPU** | 25.9s 安全 / 32.5s 被杀（executionModel=durableObject）| **DO 是 Free 层唯一能做重活的组件**（MIME 渲染、复杂 JSON 序列化可放 DO 内做）|
| **`[limits] cpu_ms` Free 不可配** | 部署报错 "CPU limits are not supported for the Free plan" | Free 层 CPU 由平台固定，不可通过 wrangler 调整 |

### 更新的文件

1. **DESIGN-DOC.md** → v2.1（标题、§0.4 事实表、§0.4b V8 沙盒陷阱、§4.8 高优路径表、changelog）
2. **free-tier-facts-verified.md** → §1 CPU 表三行修正、§1b 新增 4 个陷阱条目、§七 历史教训纠正

### 更新后的 CPU 三层模型

| 调用类型 | 设计应按 | burst 天花板 | burst 后惩罚 | 能做重活？ |
|---|---|---|---|---|
| HTTP fetch | **10ms** | ~2s | 降至 10ms | ❌ |
| Queue Consumer | **10ms** | ~2050ms | 降至 50ms | ❌ |
| Cron Trigger | **10ms** | ~1.5s | 降至 10ms | ❌ |
| **Durable Object** | **30,000ms** | 30s（硬墙）| reset（无惩罚级联）| ✅ **唯一能做重活** |

文档现在准确反映了 CF 免费层的真实 CPU 行为。请你审计。

USER:
审计之前我还想请你去查一下：涉及到的这些组件，我们测的基本都是cpu time limit，对于wall time limit，各组件是怎样的？如果该项预算给的比较充足的话，我就不打算单独测它了。

ASSISTANT:
官方文档给了完整的 wall time 限制表，**而且免费层和付费层完全一样**（文档没有 Free/Paid 区分）。汇总：

## Wall Time 限制（Free 和 Paid 相同）

| 调用类型 | Wall Time 限制 | 对本项目的影响 |
|---|---|---|
| **HTTP fetch** | **无限**（client 连接期间）；断开后 `waitUntil()` +30s | 充裕。高优路径在请求内做 render+transmit，10ms CPU 远比 wall time 先触 |
| **Queue Consumer** | **15 分钟** | 极充裕。一个 batch 处理（含多个 `await fetch`）远不到 15 分钟 |
| **Cron Trigger** | **15 分钟** | 极充裕。周期清理任务远不到 |
| **DO（RPC/HTTP）** | **无限**（caller 连接期间）| 极充裕。acquire/release RPC 只需 ms 级 |
| **DO Alarm** | **15 分钟** | 不用 alarm 则无影响 |
| **Workflows** | **无限**（per step）| 不用 Workflows 则无影响 |

## 结论：不需要单独测 wall time

**理由**：
1. **所有类型的 wall time 限制都极其宽松**——最短的是 Queue/Cron/Alarm 的 15 分钟，对本项目绰绰有余（一个 batch 处理 + 几个 `await` 远不到 15 分钟）。
2. **CPU time 是真正的瓶颈**——我们已经精测了：stateless Worker 10ms、DO 30s。在 CPU 被杀之前，wall time 永远不会先触。
3. **Free 和 Paid 的 wall time 完全一致**——文档无 Free/Paid 区分，不需要担心免费层有额外的 wall time 削减。
4. **实测已间接验证**——Spike #5 的 wallTimeMs=4424ms 毫无问题；Spike #1 的 DO 跑了 36 小时无问题。

唯一要注意的边界：**HTTP fetch 断开后只有 30 秒**（`waitUntil`）。但高优路径的 transmit 是同步等待的（不先返回再 `waitUntil`），所以这个 30 秒只影响异步归档（`ctx.waitUntil(archiveColdPath)`），而归档是几毫秒的 KV/DO 写操作，远不到 30 秒。

**不需要测 wall time。CPU 三层模型（stateless 10ms / DO 30s / burst 惩罚级联）已经覆盖了所有真实瓶颈。**

USER:
OK，我现在暂时不想审计你的文档。因为我们还有更重要的任务：请你判断一下当前我们获取的信息以及设计文档的进度，我们下一步是应该继续进行某种边界测试然后完善设计文档，还是应该开始准备MVP测试？

ASSISTANT:
这个问题问得正是时候。让我系统评估。

## 已验证的 vs 未验证的

**已通过 Spike #1-#7 彻底验证的平台级假设**：

| 假设 | 结论 | 状态 |
|---|---|---|
| DO duration 经济可行 | 36h 仅 19 GB-s（0.15%）| ✅ 定论 |
| DO 串行原子 | 并发 10 个仅 1 放行 | ✅ 定论 |
| DO RPC 性能 | 9ms 单次 / 1.5ms 平均 | ✅ 定论 |
| DO CPU 预算 | **30 秒**（唯一能做重活的组件）| ✅ 定论 |
| Queue Consumer CPU | **10ms**（burst 后惩罚至 50ms）| ✅ 定论 |
| Cron CPU | **10ms**（同上惩罚模式）| ✅ 定论 |
| HTTP fetch CPU | **10ms**（同上）| ✅ 定论 |
| `[limits] cpu_ms` | Free 不可配 | ✅ 定论 |
| Wall time 各类型 | 全部极宽松（最短 15 分钟）| ✅ 无需测 |
| QUEUE.metrics() | 可用，百毫秒级实时 | ✅ 定论 |
| Rate Limiting | 可用，CPU 极低，N+1 边界 | ✅ 定论 |

**这些是"架构能不能成立"级别的问题——全部回答了。** 架构方向确认无误。

## 剩余的未知都是"实现级"的

| 未知 | 性质 | 为什么边界测试解不了 |
|---|---|---|
| Consumer 批处理（decode+merge+chunk+render）能否在 10ms CPU 内完成？ | **实现级** | 合成 burn 循环测不了真实管线的 CPU 消耗——JSON 序列化、路由表查找、render 的实际开销只有在真实代码里才能测到 |
| Email MIME 渲染是否需要放 DO（30s 预算）？ | **实现级** | 取决于具体 Adapter 实现的渲染复杂度，只有写了 Adapter 才知道 |
| 整条管线端到端是否跑得通？ | **集成级** | 各组件单独验证了，但"串起来"的集成行为只有 MVP 能验证 |
| Email Routing `send_email` 在 Free 是否可用？ | **平台级但低风险** | 这个可以在 MVP Phase 1 里顺带验证（写一个 email Adapter 就知道了）|

**关键判断：继续边界测试的边际收益已经趋近于零。** 剩余问题都是"真实代码跑起来才知道"的，不是"再跑一个 spike 能回答"的。

## 我的决定：进入 MVP

但有一个前提要先说清楚——**Spike #7 的 CPU 发现对设计有一个尚未消化的影响**：

### Consumer 的 10ms CPU 约束比预想的紧

之前 v2.0 以为 Consumer 有 ~2000ms 预算，所以"batch 10-50 条 + 合并 + 分片 + MIME 渲染全在 Consumer 内做"。

现在纠正为 **10ms**，意味着 Consumer 内的工作链：
```
读 batch → 合并/分片 → render(每条) → acquire DO → transmit → release DO
```
其中 `acquire/transmit/release` 是 I/O（不计 CPU），但 **合并 + 分片 + render 是纯 CPU**。这 10ms 要装下：

| 操作 | 预估 CPU | 说明 |
|---|---|---|
| JSON 反序列化 N 条消息 | ~0.5ms/条 | CF 平均 Worker CPU 2.2ms/请求 |
| 路由表查找 | <0.1ms | 硬编码常量表 |
| 合并/分片 | ~0.2ms | 数组操作 |
| render（不含 MIME）| ~0.5ms/条 | JSON → TransportRequest |
| **合计 5 条 batch** | **~6ms** | 在 10ms 内 ✅ |
| **合计 10 条 batch** | **~11ms** | 可能超 ❌ |

**这意味着 batch_size 要谨慎控制**（可能 5-8 而不是 10-50），而且 **Email MIME 渲染可能确实需要放 DO**（DO 有 30s 预算，远超 MIME 的需求）。

**但这正是 MVP 要回答的问题**——合成测试测不出 render 的真实 CPU，只有写出来跑了才知道。

### MVP 的执行路径

按设计文档的 Phasing：

| Phase | 做什么 | 验证什么 | 关键 CPU 问题 |
|---|---|---|---|
| **Phase 0** | I/O Layer + Decoder + Router + render（不发送）| 输入侧管线跑通 | decode+route+render 的真实 CPU（应在 10ms 内）|
| **Phase 1** | + transmit（email/webhook）+ 高优同步路径 | 端到端推送 | 高优路径的 10ms 够吗（render+transmit 逻辑）|
| **Phase 2** | + 协调 DO（去重/熔断/车道）| 强一致协调 | DO RPC 往返 + DO 内操作的 CPU |
| **Phase 3** | + Queues 低优批处理 | 批处理管线 | **Consumer 的 10ms CPU 够吗？（关键）**|
| **Phase 4** | + 限流 + 可观测性 | 生产可用 | 限流/日志的 CPU 开销 |

**Phase 1 就是最小可行产品**——能真实推送通知，不需要 DO/Queues。跑通后用 Dashboard 看 cpuTimeMs，就知道 10ms 够不够。

Phase 3 是 CPU 最紧的一环——但到那时我们已经有 Phase 0-2 的真实 CPU 数据，能精确估算 batch 上限。

**建议从 Phase 0 开始写代码。** 要我开始吗？

USER:
可以，既然进入编码阶段，且这比之前给你的代码任务都要重，你需要重点考虑CI/CD的引入了，之前的SPIKE我在测试时多次出现问题，我不想在MVP阶段再经历一次了。可控的、自动化的测试流程很重要。而这个测试本身由你或是我来做，我们可以根据具体场景来讨论。

ASSISTANT:
你说得对，之前的 spike 经历完全暴露了"直接部署→发现问题→修→再部署"这个循环的痛苦。让我先想清楚测试策略，再开始写代码。

## 之前 spike 的痛点复盘

| 问题 | 根因 | 本可被什么拦截 |
|---|---|---|
| sendBatch 参数类型错误 | 没跑类型检查 | `tsc --noEmit` |
| wrangler.toml 缺 DO binding | 配置和代码不一致 | `wrangler deploy --dry-run` |
| KV binding 名冲突 | 手动管理命名 | 本地测试（不需部署就能发现）|
| burnCpu 死循环 | 逻辑错误没测就部署 | 单元测试 |
| Spike #5 self-fetch 死锁 | 平台陷阱不知情 | 集成测试（Miniflare 模拟）|
| 多次返工修改 | 部署后才发现问题 | **所有以上都应在部署前拦截** |

**核心教训：绝大多数问题不需要部署到 CF 才能发现。** 类型检查、dry-run、本地模拟测试就能拦住 90%。

## 我的建议：三层防线

### 第一层：本地自动化测试（部署前，我全包）

```
代码提交 → tsc 类型检查 → Vitest 单元+集成测试 → 全绿才允许部署
```

关键工具：**`@cloudflare/vitest-pool-workers`**——CF 官方的测试框架，基于 Miniflare 在本地完整模拟 Workers + DO + Queues + KV。**不需要部署到 CF 就能测 DO 串行原子性、Queue consumer 逻辑、KV 读写**。

这一层能拦截：类型错误、binding 不匹配、逻辑 bug、接口契约违反。**之前 spike 的 6 个问题里 5 个能在这里被发现。**

### 第二层：部署前验证（一行命令）

```bash
npx wrangler deploy --dry-run   # 验证 wrangler.toml 配置有效，不实际部署
```

这一层能拦截：binding 名错误、DO migration 缺失、配置语法错误。

### 第三层：部署后冒烟测试（你的部分，最小化）

部署成功后，跑一个我写好的冒烟脚本，验证"端到端真的通了"：
```bash
npx tsx test/smoke/phase0-smoke.ts   # POST 一个 webhook → 看返回的 InternalEvent
```

这一层验证本地模拟测不到的东西（CF 平台行为、网络、真实渠道响应）。

## 分工

| 任务 | 谁做 | 频率 |
|---|---|---|
| 写代码 + 写测试 | **我** | 每次提交 |
| `npm test`（本地跑测试） | **你**（或 CI 自动） | 每次改代码后 |
| `npx wrangler deploy --dry-run` | **你**（一行命令）| 部署前 |
| `npx wrangler deploy` | **你** | 测试全绿后 |
| 冒烟脚本 | **你跑**（我写脚本）| 部署后 |
| Dashboard 看 cpuTimeMs | **你** | 验证 CPU 预算 |

**关于 CI（GitHub Actions）**：可以加，但在 MVP 阶段**本地 `npm test` 就够了**。CI 的价值是"多人协作时保证主分支质量"——你一个人的项目，本地测试 + dry-run 足够。如果你要加 CI，我可以把 Vaultwarden 项目的经验直接搬过来（我们已经很熟了）。

## 具体怎么开始

我建议第一步是**搭项目骨架 + 测试基础设施**（不是先写业务代码）：

1. 项目结构（src/ + test/ + wrangler.toml + vitest.config.ts）
2. 一个能跑的最小测试（验证 Vitest + Miniflare 环境通）
3. TypeScript 严格模式 + 类型检查脚本
4. dry-run 脚本

骨架搭好、测试环境验证通过后，再开始写 Phase 0 的业务代码——**每个组件写完就配测试**，不再"写完一坨再测"。

你认同这个方向吗？如果认同，我开始搭骨架。关于 CI 要不要加、加到什么程度，你定。