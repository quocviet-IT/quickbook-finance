/**
 * Run `worker` over `items`, at most `concurrency` at a time, and hand the
 * results back in the order of `items` — never in the order they finished.
 *
 * Built for reads that each cost a round trip to a database on another
 * continent: one at a time, the waiting adds up even when every read is
 * small. The order matters to callers that hash or number what comes back
 * (the export manifest, the nightly backup's comparison with last night).
 *
 * The first failure stops new work from starting and is what this rejects
 * with; work already in flight is left to finish, and its outcome is dropped.
 */
export async function mapInOrder<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;

  // A fixed pool of pullers rather than a promise per item, as in
  // `runForAutomationCompanies`: nothing starts until a lane is free.
  async function lane(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (reason) {
        failed = true;
        throw reason;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  return results;
}
