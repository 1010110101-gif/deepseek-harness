---
kind: proposed
date: 2026-09-01
authors:
  - Copilot
---

# 面向营收接入的 PayPal IPN webhook 适配器

[English](2026-09-01-paypal-webhook-adapter.md) | 中文

## 背景

规模化营收需要 HTTP 端点接收支付提供方的事件。DeepSeek Harness 已有 `dsh-webhook` 运行时，可通过受信任的规则把已认证事件路由为 Session。GitHub webhook 已通过 `dsh-webhook-github` 集成，确立了模式。

## 决策

实现 `@deepseek-ai/dsh-webhook-paypal`，作为遵循 GitHub webhook 适配器设计的 PayPal IPN（即时付款通知）HTTP 适配器。

## 理由

### 为什么选择 PayPal IPN

- PayPal IPN 是付款确认、退款和订阅变更的标准异步通知机制
- 真实性通过 `cmd=_notify-validate` 往返校验建立：适配器把收到的原始消息原样 POST 回 PayPal，仅在收到 `VERIFIED` 回复时接受
- 表单编码的负载定义明确且稳定
- 无需轮询；事件会立即推送给部署

### 为什么复用 GitHub 适配器模式

webhook 运行时与提供方无关：适配器负责认证事件、归一化，并通过 `ctx.webhookRuntime.dispatch()` 派发。规则再决定是否创建 Session。

复用 GitHub 模式可以保证：
- 与现有代码一致（相同的注入、配置、错误处理）
- 可维护性（未来适配器遵循相同形态）
- 可测试性（经过验证的 handler 测试结构）

### 为什么即发即忘

适配器立即返回 `200 OK`，不等待规则完成或 Session 挂载。这样做：
- 以 PayPal 要求的精确 HTTP 200 确认，已接受的通知不会被重发
- 将事件摄入与下游处理（可能较慢）解耦
- 让规则按业务需求自行负责重试/去重逻辑
- 与 webhook 运行时自身的即发即忘派发模型一致

### 事件结构：name + payload

PayPal 事件带有交易类型字段（`txn_type`）。将其提取为 `event.name` 遵循 GitHub 的模式（把 `X-GitHub-Event` 提取为 `event.name`），让规则无需解析负载即可按事件类型高效过滤。

## 约束

1. 本适配器不终止 TLS；部署依赖反向代理
2. 无投递队列或重试——运行时不可用时事件会丢失
3. 无内置去重——需要时由规则负责幂等性
4. 仅通用负载校验——字段校验属于规则
5. 校验端点必须可达；往返被拒绝、失败或超时返回 `503`，以便 PayPal 重试

## 未来工作

- Webhook 重试队列（独立包）
- 事件去重服务
- PayPal Webhooks API v2 支持（从传统 IPN 迁移时）
- 面向 webhook 投递可观测性的指标/日志集成