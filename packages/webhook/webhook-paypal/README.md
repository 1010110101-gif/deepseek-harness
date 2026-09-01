---
description: "Signed PayPal IPN webhook adapter for deployments routing authenticated JSON events into the webhook runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-paypal

## Summary

`dsh-webhook-paypal` registers one exact HTTP route on the injected `ctx.webServer`. It bounds and verifies PayPal's form-encoded IPN (Instant Payment Notification) body, projects a provider-neutral delivery, calls `ctx.webhookRuntime.dispatch()`, and returns `202` without waiting for rules or Sessions. Use it when a deployment needs authenticated PayPal ingress for the generic webhook runtime.

## Table of Contents

- [Configuration](#configuration)
- [HTTP contract](#http-contract)
- [PayPal IPN setup](#paypal-ipn-setup)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

---

## Configuration

| Key | Meaning |
|---|---|
| `source` | Non-empty adapter instance carried to rules, such as `primary-paypal`. |
| `path` | Exact non-root pathname without trailing slash, query, or fragment. |
| `secretEnv` | Credential reference containing the PayPal API signature certificate. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |

All fields are required. The secret reference is resolved for every request, so rotation affects the next delivery without reloading the plugin.

## HTTP contract

Only `POST application/x-www-form-urlencoded` is accepted. The adapter reads a bounded UTF-8 body, verifies the PayPal signature using HMAC-SHA256, and processes the form-encoded parameters. It never logs the secret or payload.

| Status | Meaning |
|---|---|
| `202` | Verified payload was dispatched in memory. |
| `400` | Required Content-Type, UTF-8, form encoding, or body format was invalid. |
| `401` | Signature was invalid. |
| `405` | Method was not `POST`. |
| `413` | Declared or streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not `application/x-www-form-urlencoded`. |
| `503` | Credential or webhook runtime was unavailable. |

`202` does not state that any rule matched or that a Session was created. PayPal event-specific field validation belongs to each rule; the adapter guarantees only authenticated generic form-encoded data.

## PayPal IPN setup

### Configure your PayPal account

1. Log into PayPal merchant account
2. Go to **Settings** → **Notifications** → **Webhooks**
3. Add a webhook endpoint with:
   - **Webhook URL**: `https://your-deployment.example.com/paypal-webhook` (or your configured path)
   - **Event types**: Select payment-related events (e.g., `payment.capture.completed`, `billing_subscription.updated`)

### Store the API signature

PayPal provides an **API Signature** certificate for verifying webhooks:
1. In **Settings** → **API Signature**, copy the certificate string
2. Store it as a credential in your deployment configuration under the `secretEnv` reference name

### Verify webhook authenticity

PayPal uses HMAC-SHA256 verification with alphabetically-sorted parameters. The adapter:
1. Takes the raw form-encoded body
2. Removes the `sig` parameter
3. Sorts remaining parameters alphabetically
4. Computes HMAC-SHA256 using your API signature
5. Verifies the computed signature matches the `sig` parameter in the payload

## Model Experience

Indirectly, through `dsh-webhook`: this adapter contributes no prompt or tool schema; a matching rule owns the Session request and model-visible text.

## Known Limitations and Deferred Work

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Generic payload validation only** — rules own validation of the PayPal event fields they consume.
- **No provider acknowledgement of downstream work** — `202` precedes arbitrary rule calls and Session creation.
- **Fire-and-forget only** — no queue, replay, or retry on failure. The rule's implementation owns idempotency.
