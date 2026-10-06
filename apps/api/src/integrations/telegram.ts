/** Failure reported by (or while reaching) the Telegram Bot API. Never includes the bot token. */
export class TelegramApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never completed (network error, timeout). */
    readonly status: number,
    readonly description: string,
    /** Seconds Telegram asked us to wait (HTTP 429). */
    readonly retryAfterSeconds?: number,
  ) {
    super(`Telegram API error ${status}: ${description}`);
    this.name = 'TelegramApiError';
  }

  /** The user can no longer be reached (blocked the bot, deleted the account, never started it). */
  get isPermanent(): boolean {
    return (
      this.status === 403 ||
      (this.status === 400 && /chat not found|user is deactivated/i.test(this.description))
    );
  }
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<void>;
}

export interface TelegramClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Minimal Bot API client: only what the product uses. Plain text only (no parse_mode). */
export function createTelegramClient(options: TelegramClientOptions): TelegramClient {
  const base = options.baseUrl ?? 'https://api.telegram.org';
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async sendMessage(chatId, text) {
      let response: Response;
      try {
        response = await doFetch(`${base}/bot${options.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // The original error can embed the request URL (and so the token): do not propagate it.
        throw new TelegramApiError(0, error instanceof Error ? error.name : 'network error');
      }
      if (response.ok) return;
      const body = (await response.json().catch(() => null)) as {
        description?: string;
        parameters?: { retry_after?: number };
      } | null;
      throw new TelegramApiError(
        response.status,
        body?.description ?? response.statusText,
        body?.parameters?.retry_after,
      );
    },
  };
}
