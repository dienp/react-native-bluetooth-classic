/**
 * Holds bytes that arrive before the first consumer attaches, then fans every
 * chunk out to all consumers in arrival order. Enforces `maxBufferBytes` over
 * everything held but not yet delivered to application code.
 */
export class InboundStream {
  private backlog: Uint8Array[] = [];
  private backlogBytes = 0;
  private heldByConsumers = 0;
  private hadConsumer = false;
  private readonly consumers = new Set<(chunk: Uint8Array) => void>();
  private overflowed = false;

  constructor(
    private readonly maxBufferBytes: number,
    private readonly onOverflow: () => void
  ) {}

  push(chunk: Uint8Array): void {
    if (this.overflowed || chunk.length === 0) {
      return;
    }
    if (!this.hadConsumer) {
      this.backlog.push(chunk);
      this.backlogBytes += chunk.length;
      this.checkLimit();
      return;
    }
    for (const consumer of Array.from(this.consumers)) {
      if (this.consumers.has(consumer)) {
        consumer(chunk);
      }
    }
  }

  /**
   * Adds a consumer. The first consumer receives the backlog before any newer
   * bytes; later consumers only receive bytes that arrive after they attach.
   */
  addConsumer(consumer: (chunk: Uint8Array) => void): () => void {
    this.consumers.add(consumer);
    if (!this.hadConsumer) {
      this.hadConsumer = true;
      const backlog = this.backlog;
      this.backlog = [];
      this.backlogBytes = 0;
      for (const chunk of backlog) {
        if (this.consumers.has(consumer)) consumer(chunk);
      }
    }
    return () => {
      this.consumers.delete(consumer);
    };
  }

  /** Consumers (readers) report bytes they hold but have not handed out yet. */
  adjustHeld(delta: number): void {
    this.heldByConsumers += delta;
    this.checkLimit();
  }

  get heldBytes(): number {
    return this.backlogBytes + this.heldByConsumers;
  }

  private checkLimit(): void {
    if (!this.overflowed && this.heldBytes > this.maxBufferBytes) {
      this.overflowed = true;
      this.backlog = [];
      this.backlogBytes = 0;
      this.onOverflow();
    }
  }
}
