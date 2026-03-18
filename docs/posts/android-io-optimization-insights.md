# Android I/O 优化技术洞察（深水区）：从“哪里慢”到“为什么慢”

基于 Android 官方文档、Perfetto 方法论与生产实践整理 · 技术博客

---

你说得对：只给“建议清单”是浅层，I/O 优化真正难的是**归因**。  
同样是“磁盘慢”，可能是主线程触盘、数据库 checkpoint、后台任务争用、page fault 风暴、甚至是线程池并发策略导致的排队放大。

这篇是深水区版本，目标是回答 3 个问题：

1. **I/O 延迟到底由什么组成？**
2. **怎么在 Android 上精准归因？**
3. **哪些改造能稳定降低 P95/P99，而不引入一致性风险？**

## 一、I/O 延迟模型：别只看“读写耗时”，要看排队与屏障

一个请求的体感延迟，不是单纯 `read()/write()` 时间，而是：

`端到端延迟 = 队列等待 + 执行时间 + 同步屏障(fsync/checkpoint) + 资源争用放大`

### 洞察 1：多数线上卡顿是“排队慢”，不是“设备慢”

- 多协程并发打到同一数据库连接/同一文件系统热点目录，设备没满，队列先炸。
- UI 卡顿常见形态是：主线程被短 I/O + 锁竞争多次击穿，而不是一次超长 I/O。

### 洞察 2：`fsync`/checkpoint 是延迟尖峰制造机

- 对一致性友好的同步策略会制造周期性尖峰。
- 尖峰可接受，但不能出现在首帧/关键交互窗口。

这就是为什么 I/O 优化要做“时序治理”，不仅是“API 替换”。

## 二、归因体系：StrictMode 抓违规，Perfetto 定位根因

## 2.1 StrictMode 是“烟雾报警器”，不是“性能仪表盘”

在 Debug 尽早打开，先把主线程触盘暴露出来：

```kotlin
if (BuildConfig.DEBUG) {
    StrictMode.setThreadPolicy(
        StrictMode.ThreadPolicy.Builder()
            .detectDiskReads()
            .detectDiskWrites()
            .detectNetwork()
            .penaltyLog()
            .build()
    )

    StrictMode.setVmPolicy(
        StrictMode.VmPolicy.Builder()
            .detectLeakedClosableObjects()
            .penaltyLog()
            .build()
    )
}
```

关键点：

- `detectDiskReads/detectDiskWrites` 抓主线程违规触盘
- `detectLeakedClosableObjects` 抓未关闭流/FD，避免“慢性 I/O 污染”

## 2.2 Perfetto 才是“法医工具”

做 Android I/O 深度分析时，建议至少观察四层：

1. **App 层**：`android.os.Trace.beginSection/endSection` 自定义埋点  
2. **调度层**：主线程和核心工作线程是否长期 runnable/blocked  
3. **文件系统层**：ext4/f2fs 事件、block issue/complete 分布  
4. **数据库层**：事务、查询、checkpoint 的时间位置

> 没有 trace 埋点的 I/O 优化，通常只能到“猜测级别”。

## 2.3 让 trace 可解释：给关键 I/O 打业务切片

```kotlin
Trace.beginSection("feed:loadCache")
val feed = cacheDataSource.read()
Trace.endSection()

Trace.beginSection("user:datastore:update")
dataStore.updateData { old -> old.toBuilder().setLastSeen(now).build() }
Trace.endSection()
```

你会得到可对齐的时间线：  
“业务动作 -> 线程状态 -> 磁盘事件 -> 帧时间变化”，归因质量大幅提升。

## 三、启动 I/O：真正的瓶颈不是“读配置”，而是关键路径污染

官方启动优化文档强调：把昂贵操作移出主线程，缩短首帧前关键路径。实践里要再加一条：

### 洞察 3：冷启动常见是“非关键 I/O 被错误地放入 P0”

建议按首帧价值分层：

| 层级 | 定义 | I/O 策略 |
|------|------|----------|
| P0 | 首帧不可缺 | 允许最小同步读取 |
| P1 | 首帧后短时间需要 | 首帧后异步批量加载 |
| P2 | 非当前会话关键 | WorkManager/空闲时延后 |

### 洞察 4：Baseline + Startup Profiles 的价值是“减少启动期随机访问成本”

- Baseline Profiles：降低解释/JIT 热身开销
- Startup Profiles：优化 DEX 布局，改善启动代码局部性，降低 page fault 压力

这不是传统意义“减少业务 I/O 次数”，但能显著缩短启动关键路径上的执行与取指开销。

## 四、SharedPreferences / DataStore：性能与一致性的真实权衡

官方文档与 codelab 明确指出：SharedPreferences 的同步模型和 `apply()` 相关行为，容易在不恰当时机放大阻塞风险；DataStore 通过协程与事务化更新改善了这类问题。

### 洞察 5：SharedPreferences 问题不只“慢”，而是“不可控的落盘时机”

- 看似轻量的配置写入，可能在生命周期切换阶段放大为不可预测延迟。
- 一旦发生在主线程关键窗口（启动/页面切换），就直接转化为卡顿。

### 洞察 6：DataStore 不是免费午餐，但“可预测性更高”

- `updateData` 是事务语义，写入时序更清晰
- 适合小规模配置状态，不适合高吞吐结构化查询
- 大数据和复杂关系仍应交给 Room

## 五、Room/SQLite：决定上限的不是 ORM，而是查询形态与日志策略

Android 官方 SQLite 最佳实践可概括为：索引、事务、少读、少拷贝、合理同步策略。

### 洞察 7：WAL 解决的是并发写读冲突，但也会引入 checkpoint 管理问题

- WAL 通常显著改善并发读写体验
- 但长事务/长读可能推迟 checkpoint，导致 WAL 文件增长和后续抖动
- 优化目标不是“永远 WAL”，而是“WAL + 事务长度控制 + checkpoint 可观测”

### 洞察 8：`PRAGMA synchronous = NORMAL` 是典型“性能换极端掉电耐久”的工程决策

官方建议在 WAL 场景可评估此策略以降低每次提交 fsync 压力。  
但需明确风险边界：设备异常掉电时，可能丢失最近提交（通常不会损坏库结构）。

### 洞察 9：慢查询优化优先级应是“访问模式 > 语句微调”

优先顺序建议：

1. 是否全表扫描（缺索引）
2. 是否 `SELECT *` 读取过多列
3. 是否缺分页导致大结果集搬运
4. 是否大量单条写而非批事务

语句本身优化通常是第四优先级。

## 六、并发与调度：I/O 优化常被线程模型反向抵消

### 洞察 10：`Dispatchers.IO` 不是“无限并发许可”

如果多个模块都“尽可能并发”，会造成：

- 数据库连接争用
- 文件系统热点争用
- CPU 上下文切换上升
- 尾延迟变差（尤其 P95/P99）

实践建议：对高负载 I/O 通道做并发配额隔离（例如 `limitedParallelism`），把并发变成可控资源，而不是默认放大器。

## 6.2 WorkManager 约束是 I/O“错峰器”

对可延迟任务必须声明约束，避免和前台交互抢资源：

- `requiresCharging`
- `requiresBatteryNotLow`
- `requiresStorageNotLow`
- `setRequiredNetworkType(...)`

对 expedited work，要明确 out-of-quota 策略（降级运行或丢弃），不要让“本想加速”变成“系统频繁回退”。

## 七、文件 I/O：稳定性与性能必须一起设计

### 洞察 11：原子写比“快写”更重要

推荐流程：写临时文件 -> `flush/fsync` -> rename 覆盖。  
这样可避免异常中断后形成半写入态，减少重试风暴和数据修复成本。

### 洞察 12：碎片化小 I/O 往往比单次大 I/O 更伤体验

- 频繁小写导致 flush 更频繁
- 大量小文件随机读放大 seek/page fault
- JSON 大对象反复序列化/反序列化造成 CPU + I/O 双重放大

策略是“聚合 + 批处理 + 有界缓存”，而不是“每次都立即落盘”。

## 八、可验证的实验设计：没有实验，洞察就不可复用

建议建立统一实验矩阵：

| 维度 | 建议 |
|------|------|
| 启动类型 | 冷/温/热启动分别测 |
| 指标 | TTID、TTFD、主线程 I/O 次数、慢查询 P95、掉帧率 |
| 负载 | 前台滑动 + 后台同步并发压测 |
| 设备状态 | 电量/热状态/存储占用分层 |
| 统计 | 至少看 median + P95/P99 |

并用 Macrobenchmark 固化回归，避免“手工点点点”产生测量偏差。

## 九、落地清单（工程团队版）

### 第 1 步：把“不可见成本”变可见

- Debug 全量 StrictMode（线程 + VM）
- 核心 I/O 路径加 trace section
- 关键页面接入 Macrobenchmark + Perfetto 对照

### 第 2 步：切关键路径

- 启动链路按 P0/P1/P2 重排
- 清理首帧前非必要 I/O（日志、补偿、预热）
- 引入 Baseline/Startup Profiles

### 第 3 步：治存储与并发

- SharedPreferences -> DataStore（配置类）
- Room 索引/分页/事务/WAL 策略复核
- 高负载 I/O 通道并发限流

### 第 4 步：固化治理

- PR 模板增加“I/O 影响说明”
- 性能回归门禁关注 P95/P99
- 大版本前做一次全链路 trace 体检

## 小结：高质量 I/O 优化是“归因工程”，不是“技巧拼盘”

真正有效的 Android I/O 优化，特征非常清晰：

- 能解释慢在哪里（而不是猜）
- 能验证为什么变快（而不是感觉）
- 能控制一致性风险（而不是只追吞吐）
- 能长期回归（而不是一次性救火）

一句话收束：  
**先把 I/O 当作“系统行为”观测，再把它当作“产品能力”治理。**

---

**参考资料（官方优先）**

- Android Developers · App startup analysis and optimization  
  https://developer.android.com/topic/performance/appstartup/analysis-optimization
- Android Developers · Baseline Profiles overview  
  https://developer.android.com/topic/performance/baselineprofiles/overview
- Android Developers · Create Startup Profiles (DEX layout optimizations)  
  https://developer.android.com/topic/performance/baselineprofiles/dex-layout-optimizations
- Android Developers · StrictMode API  
  https://developer.android.com/reference/android/os/StrictMode
- Android Developers · Trace API  
  https://developer.android.com/reference/android/os/Trace
- Android Developers · DataStore  
  https://developer.android.com/topic/libraries/architecture/datastore
- Android Developers · Preferences DataStore codelab  
  https://developer.android.com/codelabs/android-preferences-datastore
- Android Developers · SQLite performance best practices  
  https://developer.android.com/topic/performance/sqlite-performance-best-practices
- Android Developers · WorkManager define work requests  
  https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
- Android Developers · Macrobenchmark overview / metrics  
  https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview  
  https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
- Perfetto Docs · Android trace analysis / PerfettoSQL  
  https://perfetto.dev/docs/getting-started/android-trace-analysis  
  https://perfetto.dev/docs/analysis/perfetto-sql-getting-started
