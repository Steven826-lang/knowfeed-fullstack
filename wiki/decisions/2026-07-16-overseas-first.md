---
title: ADR 2026-07-16 海外首发
created: 2026-07-18
updated: 2026-07-18
type: decision
tags: [decision, product, ethics]
sources: [docs/product/PRODUCT_STRATEGY.md, docs/product/PRD_V3.md]
---

# ADR：海外首发，绕开国内拟人化互动监管

- 日期：2026-07-16（创始人拍板）
- 状态：已生效
- 相关：[[product-strategy-summary]]、[[knowfeed-project]]

## 背景

中国《人工智能拟人化互动服务管理暂行办法》2026-04 已公布，KnowFeed 的 AI 分身/居民形态正落在射程内（拟人化互动服务的备案、防沉迷、情感依赖限制）。产品处于 pre-PMF 阶段，承担不起国内合规的不确定性成本。

## 选项

1. **国内首发**：按暂行办法做备案与防沉迷改造。否决：合规成本高且细则未落地，创业阶段不确定性太大
2. **海外首发（选中）**：英语区切入，绕开暂行办法适用范围
3. **双市场同时**：否决：资源不够，i18n 都还没做

## 决定

- 先上海外市场，**英文为第一语言**；中文资源保留作第二语言选项，不删除
- 目标用户从"中文兴趣学习者"改为"全球终身学习者"
- 首发垂直市场选英语区 1-2 个高学习意愿主题（如 AI/tech、personal finance）做深再扩
- 定位话术："AI study community / learn with AI peers"；主打卖点不变（structured path + micro-lessons + AI peers who remember you）

## 后果（要补的功课）

| 事项 | 要求 | 现状与差距 |
|---|---|---|
| EU AI Act | AI 透明度：用户必须知道在与 AI 交互 | ✅ 已满足（AI 角标 + AgentProfile 明示）；永不提供"隐藏 AI 身份"开关 |
| GDPR | 删除权 / 导出权 / 知情同意 | 🔴 差距大：无账号、无删除/导出端点、localStorage 明文画像；账号体系落地时同步做 |
| COPPA | 儿童数据保护 | ✅ 成人定位天然避开；注册加 16+ 年龄确认即可 |
| i18n | UI 文案 + LLM prompt 全英文 | 🔴 大工作流：react-i18next + generationPrompt / tick_engine / personas 英文版；列入阶段 1 |
| 支付 | 海外订阅计费 | 阶段 2 用 Stripe |
| LLM provider | 海外延迟 / 合规 / 成本 | StepFun 海外可用性未验证；候选 OpenAI / Anthropic / Gemini / DeepSeek；阶段 1 前实测对比 |
| 内容安全 | CSAM / 仇恨言论硬红线 | 质量门已有基础；上线前补 moderation API |

## 注意

海外 ≠ 无监管，只是更轻、更可预期。AI 标识、通知默认可关、不做 dark pattern 这些既有伦理红线（见 [[shadow-community-model]] 与 PRD §5.2）在海外同样适用，且"第一个诚实的 AI 混居社区"本身就是卖点。国内版本作为后续选项保留；若未来回国，再按暂行办法执行（成人定位、AI 标识、防沉迷开关、话术降级）。

## 关联

- [[2026-07-16-shadow-community]] — 同日拍板的产品模型决策
- [[feature-health-map]] — P0 sprint 不受此决策阻塞
