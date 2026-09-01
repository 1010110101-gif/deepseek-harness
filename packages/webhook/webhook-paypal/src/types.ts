/** Type definitions for PayPal IPN webhook events. */

/**
 * Lossless JSON representation of a PayPal IPN event payload.
 * PayPal IPN sends form-encoded data, converted to JSON-safe object.
 */
export type PayPalIpnPayload = Record<string, unknown> & {
  /** Transaction type: web_accept, subscr_signup, subscr_payment, subscr_cancel, subscr_failed, refund, etc. */
  readonly txn_type?: string
  /** Unique transaction ID issued by PayPal. */
  readonly txn_id?: string
  /** PayPal merchant account ID. */
  readonly receiver_email?: string
  /** Payer's email address. */
  readonly payer_email?: string
  /** Payer's PayPal account ID. */
  readonly payer_id?: string
  /** Total payment amount. */
  readonly mc_gross?: string
  /** Currency code (USD, EUR, etc). */
  readonly mc_currency?: string
  /** Payment status: Completed, Pending, Failed, Refunded, Reversed, Cancelled, etc. */
  readonly payment_status?: string
  /** Subscription ID for recurring payments. */
  readonly subscr_id?: string
  /** Invoice/reference custom field. */
  readonly custom?: string
}

/** Provider event supplied to `WebhookRule<'paypal'>`. */
export interface PayPalWebhookEvent {
  /** Transaction type from the IPN payload such as `web_accept` or `subscr_payment`. */
  readonly name: string
  /** Signed form-encoded object exactly as parsed from the request body. */
  readonly payload: PayPalIpnPayload
}

declare module '@deepseek-ai/dsh-webhook' {
  interface WebhookEventMap {
    paypal: PayPalWebhookEvent
  }
}
