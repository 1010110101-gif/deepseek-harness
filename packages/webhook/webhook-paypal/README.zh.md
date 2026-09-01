---
description: "Signed PayPal IPN webhook adapter for deployments routing authenticated JSON events into the webhook runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-paypal

## 摘要

`dsh-webhook-paypal` 在注入的 `ctx.webServer` 上注册一个精确的 HTTP 路由。它将 PayPal 的表单编码 IPN（即时支付通知）正文进行界限限制和验证，投影为提供者中立的交付，调用 `ctx.webhookRuntime.dispatch()`，并返回 `202` 而不等待规则或会话。当部署需要针对通用 webhook 运行时进行经过身份验证的 PayPal 入口时，使用此包。

## 目录

- [配置](#配置)
- [HTTP 协议](#http-协议)
- [PayPal IPN 设置](#paypal-ipn-设置)
- [模型体验](#模型体验)
- [已知限制和延期工作](#已知限制和延期工作)

---

## 配置

| 键 | 含义 |
|---|---|
| `source` | 非空适配器实例，传递给规则，例如 `primary-paypal`。 |
| `path` | 精确的非根路径名，不包含尾部斜杠、查询或片段。 |
| `secretEnv` | 包含 PayPal API 签名证书的凭证引用。 |
| `maxBodyBytes` | 正安全整数上限，用于未修改的请求正文。 |

所有字段都是必需的。对于每个请求都解析密钥引用，因此轮换会影响下一个交付，无需重新加载插件。

## HTTP 协议

仅接受 `POST application/x-www-form-urlencoded`。适配器读取有界限的 UTF-8 正文，使用 HMAC-SHA256 验证 PayPal 签名，并处理表单编码的参数。它从不记录密钥或有效负载。

| 状态 | 含义 |
|---|---|
| `202` | 已验证的有效负载已在内存中调度。 |
| `400` | 必需的 Content-Type、UTF-8、表单编码或正文格式无效。 |
| `401` | 签名无效。 |
| `405` | 方法不是 `POST`。 |
| `413` | 声明或流式的正文超过了 `maxBodyBytes`。 |
| `415` | 媒体类型不是 `application/x-www-form-urlencoded`。 |
| `503` | 凭证或 webhook 运行时不可用。 |

`202` 不表示任何规则匹配或已创建会话。PayPal 事件特定字段验证属于每个规则；适配器仅保证经过身份验证的通用表单编码数据。

## PayPal IPN 设置

### 配置 PayPal 账户

1. 登录 PayPal 商家账户
2. 转到 **设置** → **通知** → **Webhooks**
3. 添加 webhook 端点，其中：
   - **Webhook URL**：`https://your-deployment.example.com/paypal-webhook`（或您配置的路径）
   - **事件类型**：选择与付款相关的事件（例如 `payment.capture.completed`、`billing_subscription.updated`）

### 存储 API 签名

PayPal 为验证 webhooks 提供 **API 签名** 证书：
1. 在 **设置** → **API 签名** 中，复制证书字符串
2. 将其存储为部署配置中 `secretEnv` 引用名称下的凭证

### 验证 Webhook 真实性

PayPal 使用 HMAC-SHA256 验证。适配器：
1. 获取表单编码的正文
2. 按字母顺序对参数排序
3. 使用您的 API 签名计算 HMAC-SHA256
4. 验证签名是否与有效负载中的 `sig` 参数匹配

## 模型体验

间接通过 `dsh-webhook`：此适配器不贡献提示或工具架构；匹配的规则拥有会话请求和模型可见文本。

## 已知限制和延期工作

- **无 TLS** — 注入的开发 WebServer 通常是仅环回的，后面是 TLS 反向代理或隧道。
- **仅通用有效负载验证** — 规则拥有它们使用的 PayPal 事件字段的验证。
- **不承认下游工作** — `202` 先于任意规则调用和会话创建。
- **仅即发即忘** — 失败时没有队列、重播或重试。规则的实现拥有幂等性。
