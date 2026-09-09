# KnowFeed 文档索引

本目录是 KnowFeed 的全部项目文档。文档治理规则见 [delivery/DOCUMENTATION_GOVERNANCE.md](delivery/DOCUMENTATION_GOVERNANCE.md)；修改文档后必须跑 `npm run verify:docs` 防腐化。

## 产品文档（product/）

| 文档 | 是什么 / 给谁看 | 状态 |
| --- | --- | --- |
| [PRD_V3.md](product/PRD_V3.md) | 当前主需求文档（PRD_V2 的追加修订，冲突处以 V3 为准）。产品经理、创始人 | 现行 |
| [PRD_V2.md](product/PRD_V2.md) | 产品意图基线（北极星、目标用户），治理表中的 canonical product intent。产品经理 | 现行（被 V3 修订） |
| [PRODUCT_STRATEGY.md](product/PRODUCT_STRATEGY.md) | 创业版产品策划案：竞品、市场、架构、策略四路调研结论。创始人决策用 | 现行 |
| [FEATURE_MATRIX.md](product/FEATURE_MATRIX.md) | 功能需求矩阵与沉迷机制设计（学习流/社区流/旅程漏斗）。产品经理、设计师 | 现行 |
| [SOCIAL_PLATFORM_PLAYBOOK.md](product/SOCIAL_PLATFORM_PLAYBOOK.md) | 社交平台设计借鉴手册，PRD_V3 社区部分的设计依据。产品经理、设计师 | 现行（参考） |
| [INTRODUCTION.md](product/INTRODUCTION.md) | 项目介绍、架构边界、目录地图。新读者的第一站 | 现行 |
| [UX_FLOW.md](product/UX_FLOW.md) | 导航、屏幕、交互契约。设计师、前端工程师 | 现行 |
| [COMMUNITY_EXPERIENCE_GUIDE.md](product/COMMUNITY_EXPERIENCE_GUIDE.md) | 社区体验指南：评论 persona 的声音与身份规则。产品经理、生成逻辑工程师 | 现行 |
| [CORE_DESIGN_REFACTOR.md](product/CORE_DESIGN_REFACTOR.md) | 重构前的设计提炼：要保留的 idea、核心循环、模块边界。工程师 | 现行 |
| [RESEARCH_NOTES.md](product/RESEARCH_NOTES.md) | 产品设计时参考的外部方向笔记，非事实库。产品经理 | 存档（参考） |
| [knowfeed-project-intro.html](product/knowfeed-project-intro.html) | 可分享的项目演示简报，不是需求来源。演示/评审用 | 现行（展示 artifact） |

## 工程文档（engineering/）

| 文档 | 是什么 / 给谁看 | 状态 |
| --- | --- | --- |
| [GETTING_STARTED.md](engineering/GETTING_STARTED.md) | clone、安装、API key 配置、本地启动与验证。所有新开发者 | 现行 |
| [PROJECT_LOGIC.md](engineering/PROJECT_LOGIC.md) | 当前原型实现的完整走读。工程师 | 现行 |
| [SYSTEM_CONTRACT.md](engineering/SYSTEM_CONTRACT.md) | 模块边界与系统不变量（ID、进度、research、持久化的归属）。工程师 | 现行 |
| [LLM_CONTRACTS.md](engineering/LLM_CONTRACTS.md) | LLM schema、prompt、parser、安全契约。生成逻辑工程师 | 现行 |
| [E2E_RUNBOOK.md](engineering/E2E_RUNBOOK.md) | 真实 LLM、CuaDriver/可见浏览器、矩阵验证的可重复路径。工程师、QA | 现行 |

## 交付文档（delivery/）

| 文档 | 是什么 / 给谁看 | 状态 |
| --- | --- | --- |
| [DELIVERY_REQUIREMENTS.md](delivery/DELIVERY_REQUIREMENTS.md) | 「交付级」的定义与全量门禁。技术负责人 | 现行 |
| [RELEASE_READINESS.md](delivery/RELEASE_READINESS.md) | 发布就绪总闸门与机器可读当前状态块。技术负责人 | 现行 |
| [ACCEPTANCE_CHECKLIST.md](delivery/ACCEPTANCE_CHECKLIST.md) | 验收清单；内含历史验收证据，当前完成度以 RELEASE_READINESS 为准。QA | 现行（证据为历史） |
| [RELEASE_REVIEW_MAP.md](delivery/RELEASE_REVIEW_MAP.md) | 发布/提交前的 review 分组。技术负责人 | 现行 |
| [IMPLEMENTATION_PLAN_V2.md](delivery/IMPLEMENTATION_PLAN_V2.md) | 下一阶段实现计划（取代旧 Web3-heavy 计划）。工程师 | 现行 |
| [ALIGNMENT_AUDIT.md](delivery/ALIGNMENT_AUDIT.md) | 对齐审计记录，自我声明为历史上下文，不作当前交付状态。 | 存档 |

## 治理（governance）

| 文档 | 是什么 / 给谁看 | 状态 |
| --- | --- | --- |
| [DOCUMENTATION_GOVERNANCE.md](delivery/DOCUMENTATION_GOVERNANCE.md) | 文档治理规则：canonical 文档表、防腐化规则、必需检查（存放于 delivery/）。所有改文档的人 | 现行 |

## 商业文档（business/）

| 文档 | 是什么 / 给谁看 | 状态 |
| --- | --- | --- |
| [HKICT_PROJECT_PROPOSAL.md](business/HKICT_PROJECT_PROPOSAL.md) | 2026 香港资讯及通讯科技奖学生创新奖参赛计划书。创始人 | 现行 |

## 设计稿存档（superpowers/）

`superpowers/specs/` 与 `superpowers/plans/` 保存设计 spec 与实施计划原始稿（含 learning-community-design、co-learning-presence-engine），保持原样，按日期文件名查阅。

## 推荐阅读顺序

- **创始人**：[product/INTRODUCTION.md](product/INTRODUCTION.md) → [product/PRODUCT_STRATEGY.md](product/PRODUCT_STRATEGY.md) → [product/PRD_V3.md](product/PRD_V3.md) → [product/FEATURE_MATRIX.md](product/FEATURE_MATRIX.md) → [business/HKICT_PROJECT_PROPOSAL.md](business/HKICT_PROJECT_PROPOSAL.md) → [delivery/RELEASE_READINESS.md](delivery/RELEASE_READINESS.md)
- **产品经理**：[product/PRD_V2.md](product/PRD_V2.md) → [product/PRD_V3.md](product/PRD_V3.md) → [product/UX_FLOW.md](product/UX_FLOW.md) → [product/COMMUNITY_EXPERIENCE_GUIDE.md](product/COMMUNITY_EXPERIENCE_GUIDE.md) → [product/SOCIAL_PLATFORM_PLAYBOOK.md](product/SOCIAL_PLATFORM_PLAYBOOK.md) → [product/FEATURE_MATRIX.md](product/FEATURE_MATRIX.md) → [delivery/ACCEPTANCE_CHECKLIST.md](delivery/ACCEPTANCE_CHECKLIST.md)
- **工程师**：[engineering/GETTING_STARTED.md](engineering/GETTING_STARTED.md) → [engineering/PROJECT_LOGIC.md](engineering/PROJECT_LOGIC.md) → [engineering/SYSTEM_CONTRACT.md](engineering/SYSTEM_CONTRACT.md) → [engineering/LLM_CONTRACTS.md](engineering/LLM_CONTRACTS.md) → [product/CORE_DESIGN_REFACTOR.md](product/CORE_DESIGN_REFACTOR.md) → [engineering/E2E_RUNBOOK.md](engineering/E2E_RUNBOOK.md) → [delivery/DELIVERY_REQUIREMENTS.md](delivery/DELIVERY_REQUIREMENTS.md)
