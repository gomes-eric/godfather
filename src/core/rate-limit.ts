/** Sliding-window limiter: at most `limit` calls per `windowMs` for each key (MCP calls, voice rooms). */
export class RateLimiter {
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a call; false when the key is over its limit. */
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.calls.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.calls.set(key, recent);
      return false;
    }
    recent.push(now);
    this.calls.set(key, recent);
    return true;
  }
}
