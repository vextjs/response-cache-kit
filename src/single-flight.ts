export interface SingleFlightResult<T> {
  value: T;
  shared: boolean;
}

export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<SingleFlightResult<T>> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return {
        value: await existing,
        shared: true,
      };
    }

    const promise = fn();
    this.inflight.set(key, promise);

    try {
      return {
        value: await promise,
        shared: false,
      };
    } finally {
      this.inflight.delete(key);
    }
  }

  size(): number {
    return this.inflight.size;
  }
}
