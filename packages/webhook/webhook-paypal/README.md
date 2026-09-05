---
description: "PayPal IPN (notify-validate) HTTP webhook adapter for deployments routing verified payment events into the webhook runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-paypal

English | [中文](README.zh.md)

## Summary

`dsh-webhook-paypal` registers one exact HTTP route on the injected `ctx.webServer`. It bounds PayPal's form-encoded IPN (Instant Payment Notification) body, verifies it with PayPal's `cmd=_notify-validate` round trip, projects a provider-neutral delivery, calls `ctx.webhookRuntime.dispatch()`, and returns `200` without waiting for rules or Sessions. Use it when a deployment needs verified PayPal ingress for the generic webhook runtime.

## Table of Contents

- [Configuration](#configuration)
- [HTTP contract](#http-contract)
- [PayPal IPN setup](#paypal-ipn-setup)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

---

<a id="configuration"></a>
## Configuration

| Key | Meaning |
|---|---|
| `source` | Non-empty adapter instance carried to rules, such as `primary-paypal`. |
| `path` | Exact non-root pathname without trailing slash, query, or fragment. |
| `verifyUrl` | Absolute `cmd=_notify-validate` endpoint. Defaults to `https://ipnpb.paypal.com/cgi-bin/webscr`; point it at `https://ipnpb.sandbox.paypal.com/cgi-bin/webscr` for the sandbox. |
| `verifyTimeoutMs` | Millisecond ceiling for one verify round trip. Defaults to `10000`. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |

All fields except `verifyUrl` and `verifyTimeoutMs` are required. No shared secret is involved: PayPal IPN authenticates notifications through the verify round trip, so the adapter resolves no credential and has nothing to rotate.

<a id="http-contract"></a>
## HTTP contract

Only `POST application/x-www-form-urlencoded` is accepted. The adapter reads a bounded UTF-8 body, forwards it to the configured verification endpoint, and processes the form-encoded parameters only after PayPal replies `VERIFIED`. It never logs the body or the verification reply.

| Status | Meaning |
|---|---|
| `200` | Verified payload was dispatched in memory. |
| `400` | Required Content-Type, UTF-8, form encoding, or body format was invalid. |
| `401` | Verification endpoint did not return `VERIFIED`. |
| `405` | Method was not `POST`. |
| `413` | Declared or streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not `application/x-www-form-urlencoded`. |
| `503` | Verification endpoint timed out or was unavailable, or the webhook runtime was unavailable. |

PayPal IPN treats exactly `200` as the delivery ack and re-sends any notification answered otherwise (with escalating delays over days). The non-`200` statuses above are therefore deliberate: unverified or failed deliveries are left for PayPal to retry.

`200` does not state that any rule matched or that a Session was created. PayPal event-specific field validation belongs to each rule; the adapter guarantees only verified generic form-encoded data.

<a id="paypal-ipn-setup"></a>
## PayPal IPN setup

### Enable IPN in your PayPal account

1. Log into your PayPal merchant account.
2. Go to **Settings** → **Account settings** → **Notifications** → **Instant payment notifications** (IPN).
3. Enable IPN and set the **Notification URL** to `https://your-deployment.example.com/paypal-webhook` (or your configured `path`).

For the sandbox, repeat the same steps in a sandbox business account and set `verifyUrl` to the sandbox verification endpoint.

### Verify webhook authenticity

PayPal IPN messages carry no signature. To authenticate one, the adapter:

1. Reads the exact raw form-encoded body.
2. POSTs it back to `verifyUrl` with `cmd=_notify-validate` appended, as `application/x-www-form-urlencoded`.
3. Accepts the message only when the reply body is `VERIFIED`; `INVALID`, a failed request, or a round trip beyond `verifyTimeoutMs` is refused with a non-`200` status so PayPal retries.

The round trip is synchronous and per-request, bounded by `verifyTimeoutMs`, and the adapter holds no PayPal credentials.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-webhook`: this adapter contributes no prompt or tool schema; a matching rule owns the Session request and model-visible text.

#### KV Cache effect

Independent. Verification and HTTP dispatch do not touch a model request; any new Session prefix belongs to the consuming rule and runtime.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Generic payload validation only** — rules own validation of the PayPal event fields they consume.
- **No provider acknowledgement of downstream work** — `200` precedes arbitrary rule calls and Session creation.
- **Fire-and-forget only** — no queue, replay, or retry on failure. The rule's implementation owns idempotency.
- **Verification endpoint must be reachable** — a refused or failing round trip is answered `503`, which makes PayPal retry the notification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>