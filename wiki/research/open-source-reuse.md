---
title: 开源 Agent 框架复用调研
created: 2026-07-18
updated: 2026-07-18
type: research
tags: [research, community, backend, llm]
sources: [docs/superpowers/specs/2026-07-16-learning-community-design.md, docs/superpowers/specs/2026-07-14-co-learning-presence-engine-design.md, docs/product/PRODUCT_STRATEGY.md]
---

# 开源 Agent 框架复用调研

> 社区引擎（[[learning-community-engine]]）建设前的框架调研结论：不直接引入任何框架，只偷数据模型与策略。项目结构背景见 [[knowfeed-project]]。

## 总决策

**不直接引入框架，复用其数据模型、信念状态、prompt 策略和热榜算法。** KnowFeed 需要的是"围绕课程锚定的 Reddit 式讨论"这一单一用途引擎，不是通用多 agent 平台——框架带来的抽象层、依赖体积与许可证风险都超过收益。

## OASIS（camel-ai）— 偷 schema 与热榜

- **偷了什么**：核心表结构（worlds / agents / posts / comments / reactions / follows / user_actions 等，spec §3.1 明确"复用 OASIS schema 并扩展"）；热榜/推荐的基础思路
- **没偷什么**：框架本体。旧 OASIS 集成（`oasisCommunity.ts`、`scripts/oasis_community_worker.py`）已标记 deprecated，不再维护
- **为什么**：OASIS 是通用社交模拟研究框架，依赖重、面向实验而非产品；我们只要它的数据模型形状

## MiroShark — 偷 prompt 策略，代码禁止复制

- **偷了什么**：agent 行为 prompt 模式（基于 MiroShark 中文版改写：do_nothing 是默认动作、90% 时间潜水、允许 delta 瞬间、符合人设、上下文优先级"信念 > 时间线 > 记忆"）；动作空间类型、调度循环、SQLite trace 表、tool-call 生成模式
- **红线**：`backend/wonderwall/` 是 **AGPL-3.0**，**禁止**直接复制代码到 KnowFeed；只能复用接口思想，KnowFeed 专属逻辑（人设生成、观察 prompt、质量门、课程锚定）从头实现

## Stanford Generative Agents（Smallville）— 偷信念/记忆模型

- **偷了什么**：BeliefState 概念（positions / confidence / trust + reflection）——25 个有记忆的 agent 能涌现可信社会行为已被 Smallville 证明（创始人后续融资 $1 亿）
- **改造**：不做全量 LLM 反思（成本不可控），改启发式更新 + `recent_reflection` 字段；加**回音室抑制三件套**（信任回归 2%、自信度上限 0.85、强制对立曝光）——Smallville 没有防抱团机制，社区产品必须有

## AutoGen / Letta — 通用框架路线，排除

> 文档中未留下这两个框架的专项评估记录；以下为架构决策反推的排除理由。

- **AutoGen**：面向"多个 agent 协作完成任务"的对话编排框架，与"持久社区成员各自生活"的模型不匹配；引入它等于背上一个编排层去解决不存在的问题
- **Letta（MemGPT）**：核心是 agent 长期记忆管理，但其记忆抽象面向单 agent 助手场景；KnowFeed 的信念演化是社区级、规则化、低成本（不调 LLM）的启发式更新，Letta 的 memory block / 归档检索对 25-30 居民 × 每轮 tick 的规模过重
- **共同排除理由**：单进程 + SQLite + FastAPI 的轻量后端已够用；引擎行为必须被质量门、成本上限（60 次/日/world）、测试基线完全掌控——框架黑盒与这三个硬约束冲突

## 结论

- **可偷清单**：OASIS 的表结构、MiroShark 的 prompt 模式、Smallville 的信念模型——全部已落地为 `server/colearning/` 的自有实现
- **不可偷清单**：MiroShark 代码（AGPL）、任何框架本体
- 后续评估新框架按同一标准过三关：是否解决真实存在的问题、许可证是否兼容、是否破坏质量门 / 成本 / 测试三大约束

## 关联

- [[learning-community-engine]] — 借鉴落地后的引擎实现
- [[shadow-community-model]] — 引擎在分身社区中的新角色（催化层）
