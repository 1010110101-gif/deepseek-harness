---
description: "PayPal IPN（notify-validate）HTTP webhook 适配器，用于将经过验证的支付事件路由到 webhook 运行时。"
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-paypal

[English](README.md) | 中文

## 概述

`dsh-webhook-paypal` 在注入的 `ctx.webServer` 上注册一条精确 HTTP 路由。它限制 PayPal 表单编码的 IPN（即时付款通知）请求体大小，通过 PayPal 的 `cmd=_notify-validate` 往返校验进行验证，投影为提供者无关的交付对象，调用 `ctx.webhookRuntime.dispatch()`，并在不等待规则或会话的情况下返回 `200`。当部署需要为通用 webhook 运行时提供经过验证的 PayPal 入口时，请使用此包。

## 目录

- [配置](#configuration)
- [HTTP 约定](#http-contract)
- [PayPal IPN 设置](#paypal-ipn-setup)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

---

<a id="configuration"></a>
## 配置

| 键 | 含义 |
|---|---|
| `source` | 传递给规则的非空适配器实例名，例如 `primary-paypal`。 |
| `path` | 非根绝对路径名，不带尾部斜杠、查询串或片段。 |
| `verifyUrl` | 绝对 `cmd=_notify-validate` 校验端点。默认为 `https://ipnpb.paypal.com/cgi-bin/webscr`；沙箱环境请配置为 `https://ipnpb.sandbox.paypal.com/cgi-bin/webscr`。 |
| `verifyTimeoutMs` | 单次校验往返的毫秒上限。默认为 `10000`。 |
| `maxBodyBytes` | 原始请求体的正安全整数上限（字节）。 |

除 `verifyUrl` 和 `verifyTimeoutMs` 外所有字段均为必填。该适配器不涉及共享密钥：PayPal IPN 通过校验往返确认通知的真实性，因此无需解析任何凭据，也无须轮换。

<a id="http-contract"></a>
## HTTP 约定

只接受 `POST application/x-www-form-urlencoded`。适配器读取有上限的 UTF-8 请求体，将其转发到配置的校验端点，并且仅在 PayPal 回复 `VERIFIED` 后才处理表单参数。它从不记录请求体或校验回复。

| 状态 | 含义 |
|---|---|
| `200` | 已验证的负载已在内存中派发。 |
| `400` | 必需的 Content-Type、UTF-8、表单编码或请求体格式无效。 |
| `401` | 校验端点未返回 `VERIFIED`。 |
| `405` | 请求方法不是 `POST`。 |
| `413` | 声明或流式传输的请求体超过 `maxBodyBytes`。 |
| `415` | 媒体类型不是 `application/x-www-form-urlencoded`。 |
| `503` | 校验端点超时或不可用，或 webhook 运行时不可用。 |

PayPal IPN 将恰好 `200` 视为投递确认；其他任何状态都会让 PayPal 重新发送通知（延迟逐级加大，持续数天）。因此上述非 `200` 状态是有意为之：未验证或投递失败的通知留给 PayPal 重试。

`200` 不代表任何规则命中或会话已创建。PayPal 事件字段的具体校验属于各规则；该适配器只保证经过验证的通用表单数据。

<a id="paypal-ipn-setup"></a>
## PayPal IPN 设置

### 在 PayPal 账户中启用 IPN

1. 登录 PayPal 商家账户。
2. 进入 **设置** → **账户设置** → **通知** → **即时付款通知（IPN）**。
3. 启用 IPN，并将**通知 URL** 设置为 `https://your-deployment.example.com/paypal-webhook`（或你配置的 `path`）。

沙箱环境请使用沙箱商家账户重复以上步骤，并将 `verifyUrl` 指向沙箱校验端点。

### 验证 webhook 真实性

PayPal IPN 消息不携带签名。适配器按以下步骤验证：

1. 读取原始表单编码请求体。
2. 将其以 `application/x-www-form-urlencoded` 形式 POST 回 `verifyUrl`，并在末尾追加 `cmd=_notify-validate`。
3. 仅当回复体为 `VERIFIED` 时接受消息；`INVALID`、请求失败或往返超过 `verifyTimeoutMs` 都以非 `200` 状态拒绝，以便 PayPal 重试。

该校验按请求同步进行，受 `verifyTimeoutMs` 限制，且适配器不持有任何 PayPal 凭据。

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-webhook`: this adapter contributes no prompt or tool schema; a matching rule owns the Session request and model-visible text.

#### KV Cache effect

Independent. Verification and HTTP dispatch do not touch a model request; any new Session prefix belongs to the consuming rule and runtime.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **无 TLS** — 注入的开发 WebServer 通常仅监听回环地址，生产环境需由 TLS 反向代理或隧道承接。
- **仅通用负载校验** — 规则负责校验其消费的 PayPal 事件字段。
- **不对下游工作进行提供者确认** — `200` 先于任意规则调用和会话创建。
- **仅即发即忘** — 失败时无队列、重放或重试；幂等性由规则实现负责。
- **校验端点必须可达** — 往返被拒绝或失败时返回 `503`，使 PayPal 重试该通知。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>