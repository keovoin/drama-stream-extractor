import { describe, expect, it } from "vitest";
import { claimNextQueuedItem, type QueueItem } from "../client/src/lib/queueOrchestrator";

type TestProgress = { state: "processing" | "completed" | "failed"; title: string };

const queue: QueueItem<TestProgress>[] = [
  { id: "first", url: "https://example.test/?slug=first", state: "queued", progress: null, error: null },
  { id: "second", url: "https://example.test/?slug=second", state: "queued", progress: null, error: null },
];

describe("client queue orchestration", () => {
  it("claims only the first queued item, then hands off to the next after successful completion while preserving the completed card", () => {
    const firstClaim = claimNextQueuedItem(queue);
    expect(firstClaim.next).toMatchObject({ id: "first", state: "starting" });
    expect(firstClaim.queue.map(item => item.state)).toEqual(["starting", "queued"]);

    const blockedWhileActive = claimNextQueuedItem(firstClaim.queue);
    expect(blockedWhileActive.next).toBeNull();
    expect(blockedWhileActive.queue).toEqual(firstClaim.queue);

    const firstCompleted = firstClaim.queue.map(item => item.id === "first"
      ? { ...item, state: "completed" as const, progress: { state: "completed" as const, title: "First Queue Drama" } }
      : item,
    );
    const secondClaim = claimNextQueuedItem(firstCompleted);

    expect(secondClaim.next).toMatchObject({ id: "second", state: "starting" });
    expect(secondClaim.queue[0]).toMatchObject({ id: "first", state: "completed", progress: { title: "First Queue Drama" } });
    expect(secondClaim.queue[1]).toMatchObject({ id: "second", state: "starting" });
  });
});
