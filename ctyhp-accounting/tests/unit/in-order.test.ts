import { describe, expect, it } from "vitest";
import { mapInOrder } from "@/lib/domain/in-order";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapInOrder", () => {
  it("hands results back in the order of the items, not the order they finished", async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await mapInOrder(delays, 3, async (ms, index) => {
      await wait(ms);
      return `${index}:${ms}`;
    });
    expect(results).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10"]);
  });

  it("never has more than the limit in flight", async () => {
    let inFlight = 0;
    let most = 0;
    await mapInOrder(Array.from({ length: 12 }, (_, i) => i), 4, async (i) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await wait(i % 3);
      inFlight -= 1;
    });
    expect(most).toBe(4);
  });

  it("starts nothing new after a failure, and rejects with it", async () => {
    const started: number[] = [];
    await expect(
      mapInOrder([0, 1, 2, 3, 4, 5], 2, async (i) => {
        started.push(i);
        await wait(1);
        if (i === 1) throw new Error("Reading acc_bill failed");
      }),
    ).rejects.toThrow("Reading acc_bill failed");
    expect(started).toEqual([0, 1, 2]);
  });

  it("handles no items, and refuses a limit that is not a whole number above zero", async () => {
    expect(await mapInOrder([], 6, async () => 1)).toEqual([]);
    await expect(mapInOrder([1], 0, async () => 1)).rejects.toThrow("positive integer");
    await expect(mapInOrder([1], 1.5, async () => 1)).rejects.toThrow("positive integer");
  });
});
