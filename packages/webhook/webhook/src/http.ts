/** Shared HTTP body intake and response primitives for webhook provider adapters. */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** HTTP refusal whose message is safe to return without request data. */
export class WebhookHttpError extends Error {
  override readonly name = 'WebhookHttpError'

  constructor(
    readonly status: 400 | 401 | 405 | 413 | 415 | 503,
    message: string,
  ) {
    super(message)
  }
}

/** Parse a decimal Content-Length or reject an ambiguous header. */
function contentLength(request: IncomingMessage): number | undefined {
  const value = request.headers['content-length']
  if (value === undefined) return undefined
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new WebhookHttpError(400, 'invalid Content-Length')
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new WebhookHttpError(413, 'request body is too large')
  return length
}

/**
 * Read one request body as exact, bounded UTF-8 text.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the decoded body after EOF.
 * @throws {WebhookHttpError} for invalid length, excessive bytes, invalid UTF-8, or an aborted stream.
 */
export async function readBoundedUtf8Body(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<string> {
  const declared = contentLength(request)
  if (declared !== undefined && declared > maxBodyBytes) {
    request.resume()
    throw new WebhookHttpError(413, 'request body is too large')
  }

  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new WebhookHttpError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof WebhookHttpError) throw error
    throw new WebhookHttpError(400, 'request body was aborted')
  }
  if (!request.complete) throw new WebhookHttpError(400, 'request body was aborted')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    // TextDecoder is the only statement in the try; each provider names its body format at the call site.
    throw new WebhookHttpError(400, 'request body is not valid UTF-8')
  }
}

/** Whether one Content-Type header names exactly `mediaType` with at most one UTF-8 charset parameter. */
export function isWebhookContentType(value: string | undefined, mediaType: string): boolean {
  if (value === undefined) return false
  const parts = value.split(';').map(part => part.trim())
  const [actual, parameter, ...extra] = parts
  if (actual?.toLowerCase() !== mediaType) return false
  if (parameter === undefined) return true
  return extra.length === 0 && /^charset=(?:utf-8|"utf-8")$/i.test(parameter)
}

/** Send one empty or plain-text response exactly once. */
export function webhookRespond(response: ServerResponse, status: number, message?: string): void {
  if (message === undefined) {
    response.writeHead(status)
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(message)
}
