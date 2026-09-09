# KnowFeed Wiki — Agent 使用指南

## Wiki 位置

`wiki/`（项目根下）— KnowFeed 项目级知识库。配合全局 wiki `~/wiki/` 使用：项目域知识优先查本库。

## 结构

- `index.md` — 内容索引，按类型分类（Entities / Concepts / Decisions / Research）
- `concepts/` — 概念文档（社区模型、引擎架构、推荐、战略摘要、功能健康度）
- `entities/` — 实体文档（项目总览）
- `decisions/` — ADR（带日期前缀）
- `research/` — 调研蒸馏（社交平台机制、开源框架复用）
- `SCHEMA.md` — wiki 格式规范与 tag taxonomy
- `log.md` — 变更日志（append-only）

## 读取规则

1. **接到任务** → 先读 `index.md` 找相关页面
2. **代码入口/命令/基线** → 读 `entities/`（[[knowfeed-project]]）
3. **产品/社区/推荐问题** → 读 `concepts/`
4. **"为什么这么决定"** → 读 `decisions/` 的 ADR
5. **需要完整论证** → 按页面 frontmatter 的 `sources` 字段回读 `docs/` 原文

## 写入规则

1. 新知识按 `SCHEMA.md` 创建页面：小写连字符文件名、YAML frontmatter、≥2 条 `[[wikilinks]]`
2. 修改页面 → 更新 frontmatter 的 `updated` 日期
3. 新页面 → 登记 `index.md` 正确分区
4. 任何变更 → 追加 `log.md`
5. tags 只能取自 SCHEMA 的 taxonomy；新 tag 先加进 SCHEMA.md 再使用
6. wiki 是蒸馏层：不复述 docs/ 全文，存结论、关键数字与指针

## 关键页面

- [[knowfeed-project]] — 项目总览（技术栈 / 目录地图 / 命令 / 测试基线）
- [[shadow-community-model]] — 分身社区模型（当前产品模型，2026-07-16 拍板）
- [[learning-community-engine]] — 社区引擎模块地图（tick / belief / recommender / quality）
- [[feature-health-map]] — 22 个功能单元健康度 + P0 sprint 七项
- [[recommender-v2]] — 推荐 v2 设计（负反馈 / 探索配额 / 配比控制）

## 本文件

此文件路径: `wiki/AGENTS.md`
最后更新: 2026-07-18
