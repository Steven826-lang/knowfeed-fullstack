---
title: 功能健康度地图
created: 2026-07-18
updated: 2026-07-18
type: concept
tags: [product, lesson, community, sprint]
sources: [docs/product/FEATURE_MATRIX.md, docs/product/PRD_V3.md]
---

# 功能健康度地图

> 蒸馏自 FEATURE_MATRIX.md（2026-07-16，学习流/社区流/沉迷机制/旅程漏斗四路调研）。评分 1-5：1=需求没想清楚，2=实现残缺/失真，3=可用但平庸，4=良好，5=优秀。P0 sprint 的战略上下文见 [[product-strategy-summary]]。

## 学习流（9 个单元）

| # | 功能 | 评分 | 一句话诊断 | 优先级 |
|---|---|---|---|---|
| L1 | Onboarding 采集 | 4/5 | 深度/语气是"死参数"，采集了没人用 | P1 |
| L2 | 路径规划 | 3/5 | "7 天"名不副实（不足 7 天静默充数） | P1 |
| L3 | 路径预览 | 3/5 | 是"收据"不是"预览"，个性化理由不可见 | P1 |
| L4 | 微课堂 | 3/5 | completionFeedback 生成了却从不渲染 | P0 |
| L5 | 答题与反馈 | 2/5 | 答案恒 a + 无判定瞬间 + 答错零成本，激励链失真 | P0 |
| L6 | 掌握度/XP/streak | 2.5/5 | streak 是假的（计数器非日历），44<70 首日必撞墙 | P0 |
| L7 | 复习队列 | 1.5/5 | 幽灵功能：写入端存在，UI 层不存在 | P0 |
| L8 | 知识地图 | 3/5 | 是列表不是地图，锁定状态不给出路 | P2 |
| L9 | AI 分身草稿 | 3/5 | 草稿不基于这次学习，批准发布到"虚空" | P0 |

## 社区流（13 个单元）

| # | 功能 | 评分 | 一句话诊断 | 优先级 |
|---|---|---|---|---|
| C1 | 推荐 Feed | 3/5 | 无限滚动/briefing/手动刷新都付了后端成本，前端没用 | P0 |
| C2 | 帖子详情/评论树 | 4/5 | 点赞数丢失、"引用"是假功能 | P1 |
| C3 | 发帖 | 4/5 | 不能选目标 concept | P2 |
| C4 | 评论/回复 | 4/5 | 轮询 30s vs 承诺 30-90s 错配 | P1 |
| C5 | 点赞/点踩 | 2/5 | 前端从未调用 API，热度是 agent 自循环 | P0 |
| C6 | AI 居民人格 | 4/5 | 只有 12 个名字，人设一致性无校验 | P1 |
| C7 | 信念/记忆 | 4/5 | "记忆"名不副实，delta 瞬间无 UI 出口 | P1 |
| C8 | 帖主维护 | 4/5 | 良好，里程碑总结可进推荐 | P2 |
| C9 | Tick 演化 | 4/5 | concept_id 永不更新且 prompt 里是哈希——两张皮的根 | P0 |
| C10 | 唤醒补时 | 3/5 | 后端 5 分前端 1 分：briefing 从不渲染 | P0 |
| C11 | 推荐反馈 | 3/5 | 只存 localStorage，换设备即丢 | P2 |
| C12 | Agent 主页 | 4/5 | 缺信念轨迹与关系网展示 | P2 |
| C13 | 关注 | 2/5 | 关注对推荐零影响、状态无回显，纯计数器 | P1 |

## P0 七项（下一 sprint 全部内容，预估 1-2 周）

1. **L5 quiz 修复**：答案位置随机（不再恒 choice-a）、两段式提交、答错"看提示重答"半分（mastery +16 而非 +32）
2. **L6 真 streak**：自然日驱动 + streak freeze（每周送 1 最多存 2，文案中性禁 guilt-trip）+ mission 阈值 70→40 保证 D2 是第 2 课
3. **L7 复习队列**：`{conceptId, completedAt, dueAt, stage}[]` 间隔 +1/+3/+7 天，feed 顶部"今日复习"卡优先于新课
4. **L9 费曼输出闭环（旗舰）**：草稿课后生成（输入 = lesson + quiz 对错 + freeResponse 原话），批准 = 真实发布触发 mini-tick，分身/居民 30-90 秒内来追问——学习有效性 + 留存 + 差异化三合一，机制背景见 [[shadow-community-model]]
5. **C5 三级互动信号**：有用（主信号）/ 收藏（进个人资产库）/ 赞同（权重最低）接通 `/reactions`，不做 downvote
6. **C9+C10 两张皮修复包**：完课同步 `current_concept_id`、concept_id→title 映射入所有 prompt、叙事版简报卡渲染
7. **C1 feed 收尾 + 推荐 v2**：cursor 无限滚动、理由映射 concept 标题、真实 presence 口径、负反馈/保底曝光/重排硬约束（见 [[recommender-v2]]）

## 跨模块系统性缺陷（比单功能更重要）

1. **社区与微课"两张皮"**（P0 之根）：tick/world_init 的 prompt 只拿到 topic 标题 + 哈希 concept_id，agent 不知道用户在学什么；完课不触发任何社区事件
2. **激励信号失真三连**：答案恒 a（quiz 失效）→ 答错也涨分（mastery 失真）→ streak 计数器化（连续性失真）
3. **"数据产生但不消费"模式反复出现**：completionFeedback、reviewQueue、freeResponse、targetDepth/preferredTone、sourceUrls、briefing、follows——每个字段都缺"用户可感知出口"
4. **无通知体系**：用户发帖后离开就断联，没有任何召回通道

## 用户旅程三大断点

- **A. 首次生成等待 40-90s**（流失风险极高）→ 时间预期 + 个性化流水 + 失败自动降级重试 + 快速模式
- **B. 首课完成后 60 秒 wow 缺失** → 渲染 completionFeedback + 前后对照评论 + 草稿前置 + 明日悬念
- **C. D2 回访首屏无回归理由** → mission 修复 + 简报卡 + 真 streak + 复习卡

## 关联

- [[product-strategy-summary]] — P0 之后的路线图与达标线
- [[learning-community-engine]] — C9/C10 涉及的引擎侧实现
