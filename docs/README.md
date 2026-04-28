# AI-StoryFlow 设计文档

AI 写故事工作流系统——给工作室 40 人内部使用的批量故事生成 + 审核 + 导出平台。

## 文档导航

| # | 文档 | 内容 |
|---|---|---|
| 01 | [项目概述](./01-overview.md) | 背景、目标、关键决策 |
| 02 | [总体架构](./02-architecture.md) | 架构图、模块清单、技术栈 |
| 03 | [工作流与状态机](./03-workflow-state-machine.md) | 任务/段落状态机、转换矩阵 |
| 04 | [故事生成编排引擎](./04-story-orchestration.md) | 章节生成、续写、上下文管理 |
| 05 | [流式输出机制](./05-streaming.md) | SSE 通道、Redis Stream、前端渲染 |
| 06 | [审核与编辑机制](./06-review-and-edit.md) | 段级编辑、AI 辅助修改、版本历史 |
| 07 | [任务调度与并发](./07-task-scheduling.md) | 公平队列、暂停/继续、容量配置 |
| 08 | [LLM 接入与 Key 管理](./08-llm-and-keys.md) | 中转站接入、模型降级链、用户 key |
| 09 | [数据模型](./09-data-model.md) | PostgreSQL Schema 完整 DDL |
| 10 | [API 规范](./10-api-spec.md) | REST/SSE 端点详细定义 |
| 11 | [前端模块](./11-frontend.md) | 页面结构、组件、状态管理 |
| 12 | [部署方案](./12-deployment.md) | docker-compose、环境配置 |
| 13 | [监控与告警](./13-monitoring.md) | 指标、告警、凌晨巡检 |
| 14 | [实现范围与开发顺序](./14-roadmap.md) | 全量目标、技术依赖顺序（无周计划） |

## 附录

- [Prompt 模板](./appendix/prompts.md)
- [错误码表](./appendix/error-codes.md)
- [配置项清单](./appendix/config.md)

## 阅读建议

**产品/需求人员**：01 → 03 → 06 → 11

**后端开发**：02 → 03 → 04 → 07 → 08 → 09 → 10 → 12

**前端开发**：02 → 05 → 06 → 10 → 11

**运维**：02 → 12 → 13

## 版本

- v1.0 — 2026-04-28 — 初稿
