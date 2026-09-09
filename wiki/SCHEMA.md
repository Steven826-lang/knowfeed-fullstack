# KnowFeed Wiki Schema

## Domain
KnowFeed 项目级知识库：产品决策、分身社区模型、社区引擎架构、推荐系统、功能健康度、调研结论。本规范沿用全局 wiki（`~/wiki/SCHEMA.md`）约定，tag taxonomy 换成本项目域。项目域问题优先查本 wiki，跨项目知识（记忆系统、通用框架调研等）查全局 wiki。

## Conventions
- File names: lowercase, hyphens, no spaces (e.g., `shadow-community-model.md`)
- Decision pages 带日期前缀：`decisions/YYYY-MM-DD-<slug>.md`
- Every wiki page starts with YAML frontmatter (see below)
- Use `[[wikilinks]]` to link between pages (minimum 2 outbound links per page)
- When updating a page, always bump the `updated` date
- Every new page must be added to `index.md` under the correct section
- Every action must be appended to `log.md`
- Language: 中文为主，技术术语用英文

## Frontmatter
```yaml
---
title: Page Title
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: entity | concept | decision | research
tags: [from taxonomy below]
sources: [项目内相对路径，如 docs/product/PRD_V3.md]
---
```

## Tag Taxonomy
- product: 产品定位、战略、路线
- community: 社区机制、治理、NPC 催化层
- shadow: AI 分身（Shadow）相关
- lesson: 学习流（微课、quiz、mastery、streak、复习）
- recommender: 推荐系统
- llm: LLM 工程（prompt、成本、provider、质量门）
- frontend: React/Vite 前端
- backend: FastAPI/SQLite 后端
- decision: 产品/架构决策（ADR）
- research: 调研结论蒸馏
- ethics: 伦理红线、合规
- sprint: 迭代计划、验收指标

Rule: every tag on a page must appear in this taxonomy. If a new tag is needed,
add it here first, then use it.

## Page Thresholds
- **Create a page** when an entity/concept appears in 2+ sources OR is central to one source
- **Add to existing page** when a source mentions something already covered
- **DON'T create a page** for passing mentions or minor details outside the domain
- **Split a page** when it exceeds ~200 lines — break into sub-topics with cross-links

## Distillation Policy
wiki 是蒸馏层，不是 docs/ 的副本：存结论、关键数字、跨文档关联与指针（sources 字段指回原文）。不复述 docs/ 全文；需要完整论证时读 sources。

## Update Policy
When new information conflicts with existing content:
1. Check the dates — newer sources generally supersede older ones
2. If genuinely contradictory, note both positions with dates
3. Mark the contradiction in frontmatter: `contradictions: [page-name]`
