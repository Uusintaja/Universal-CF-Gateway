# Review TODO - Code review loop per §6

> 每轮讨论开始时清空或移出已解决项，保留未解决，讨论结束记录待执行项，执行开始读，执行结束更新状态

## Active (P0/P1)

* [ ] Zod 静态校验 InternalEvent / TransportRequest - P1，Phase0 遗留，待 `src/validation/` + `test/validation/`
* [ ] Rate Limiting binding 接入 - P1，Phase4，但需提前确认 namespace 创建方式是否需显式通知用户（已按本次 Phase2 教训，后续新组件前显式指示）

## Resolved / Moved to Hardening

* [x] wrangler 3.114 critical out-of-date -> 4.72+ - P0，已修 81dde98 / 18c0b42
* [x] Queue/KV placeholder 导致部署失败 Queue does not exist / KV namespace invalid - P0，已修，Phase1/2 最小无绑定
* [x] package-lock 不同步导致 npm ci EUSAGE Invalid workerd - P0，已修切 npm install --legacy-peer-deps + 再生锁
* [x] DO Invalid ID + does not support RPC - P0，已修 idFromName + extends DurableObject，平台冒烟已验证 lane:high_exclusive / dedup_skip
* [x] .git/config 快照剥离致 push 失败 - 过程陷阱，已在执行脚本中按需重建

## Parking Lot (P2 - 延后到 MVP Acceptance & Hardening)

* Email 真实收件验证 emailhook.site 真收
* MIME 渲染移 DO 内评估
* wrangler 4.110 需 Node22 升级路径
* 更细 trace 字段 / 指标聚合

