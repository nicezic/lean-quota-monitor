export type ConcurrentRefreshPolicy = 'join' | 'rerun';

export class RefreshCoordinator {
  readonly #running = new Map<string, Promise<void>>();
  readonly #rerunTasks = new Map<string, () => Promise<void>>();

  run(
    key: string,
    task: () => Promise<void>,
    policy: ConcurrentRefreshPolicy = 'join',
  ): Promise<void> {
    const active = this.#running.get(key);
    if (active) {
      if (policy === 'rerun') this.#rerunTasks.set(key, task);
      return active;
    }

    let running: Promise<void>;
    running = Promise.resolve()
      .then(async () => {
        let lastError: unknown;
        let currentTask = task;
        for (;;) {
          try {
            await currentTask();
            lastError = undefined;
          } catch (error) {
            lastError = error;
          }
          const rerunTask = this.#rerunTasks.get(key);
          if (!rerunTask) break;
          this.#rerunTasks.delete(key);
          currentTask = rerunTask;
        }
        if (lastError !== undefined) throw lastError;
      })
      .finally(() => {
        if (this.#running.get(key) === running) this.#running.delete(key);
        this.#rerunTasks.delete(key);
      });
    this.#running.set(key, running);
    return running;
  }
}
