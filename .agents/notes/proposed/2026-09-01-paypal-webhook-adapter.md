---
kind: proposed
date: 2026-09-01
authors:
  - Copilot
---

# PayPal IPN webhook adapter for revenue ingestion

English | [中文](2026-09-01-paypal-webhook-adapter.zh.md)

## Context

Revenue at scale requires HTTP endpoints to receive billing events from payment providers. DeepSeek Harness already has a `dsh-webhook` runtime that routes authenticated events through trusted rules to create Sessions. GitHub webhooks are already integrated via `dsh-webhook-github`, establishing a pattern.

## Decision

Implement `@deepseek-ai/dsh-webhook-paypal` as a PayPal IPN (Instant Payment Notification) HTTP adapter following the GitHub webhook adapter's design.

## Rationale

### Why PayPal IPN

- PayPal's IPN is the standard asynchronous notification mechanism for payment confirmations, refunds, and subscription changes
- Authenticity is established by the `cmd=_notify-validate` round trip: the adapter POSTs the exact received message back to PayPal and accepts it only on a `VERIFIED` reply
- Form-encoded payloads are well-defined and stable
- No polling required; events are pushed to us immediately

### Why replicate the GitHub adapter pattern

The webhook runtime is provider-agnostic: adapters authenticate events, normalize them, and dispatch through `ctx.webhookRuntime.dispatch()`. Rules then decide whether to create Sessions.

Replicating GitHub's pattern ensures:
- Consistency with existing code (same injection, configuration, error handling)
- Maintainability (future adapters follow the same shape)
- Testability (proven handler test structure)

### Why fire-and-forget

The adapter returns `200 OK` immediately without waiting for rule completion or Session attachment. This:
- Acks with exactly the HTTP 200 PayPal requires, so accepted IPNs are not re-sent
- Decouples event ingestion from downstream processing (which may be slow)
- Allows rules to own retry/deduplication logic per business need
- Matches the webhook runtime's own fire-and-forget dispatch model

### Event structure: name + payload

PayPal events have a transaction type field (`txn_type`). Extracting this as `event.name` follows GitHub's pattern (extracting `X-GitHub-Event` as `event.name`) and allows rules to efficiently filter by event type without parsing the payload.

## Constraints

1. No TLS termination in this adapter; deployment expects a reverse proxy
2. No delivery queue or retry — events are lost if the runtime is unavailable
3. No built-in deduplication — rules own idempotency if needed
4. Generic payload validation — field validation belongs in rules
5. The verification endpoint must be reachable; a refused, failed, or timed-out round trip answers `503` so PayPal retries

## Future work

- Webhook retry queue (separate package)
- Event deduplication service
- PayPal Webhooks API v2 support (when migrating from legacy IPN)
- Metrics/logging integration for webhook delivery observability