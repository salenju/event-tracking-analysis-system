interface Window {
  count: number;
  resetAt: number;
}

export interface HitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * 内存固定窗口限流：零依赖，单进程足够。
 * 拆成多进程（START_MODE=ingest|api）时按单进程额度计算，可接受。
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly windowMs = 60_000,
    private readonly maxEntries = 50_000,
  ) {
    this.timer = setInterval(() => this.collect(), windowMs);
    // 不要因为没有业务流量阻止进程退出
    this.timer.unref?.();
  }

  hit(key: string, limit: number, now = Date.now()): HitResult {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: Math.max(limit - 1, 0), retryAfterSeconds: 0 };
    }
    current.count += 1;
    const retryAfterSeconds = Math.max(Math.ceil((current.resetAt - now) / 1000), 1);
    if (current.count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: Math.max(limit - current.count, 0), retryAfterSeconds: 0 };
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.windows.clear();
  }

  get size(): number {
    return this.windows.size;
  }

  private collect(now = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // 极端情况下（大量伪造 IP）直接清空，避免内存无上限增长
    if (this.windows.size > this.maxEntries) this.windows.clear();
  }
}
