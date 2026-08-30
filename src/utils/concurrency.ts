/**
 * Minimal counting semaphore used to bound concurrent LinkedIn extractions.
 *
 * The LinkedIn client is a singleton shared across requests; this caps how many
 * profile extractions run at once so bursts through the public API cannot
 * hammer LinkedIn's endpoints or exhaust the host.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit < 1 ? 1 : limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
