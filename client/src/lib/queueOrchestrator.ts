export type QueueItemState = "queued" | "starting" | "processing" | "completed" | "failed";

export type QueueItem<TProgress = unknown> = {
  id: string;
  url: string;
  sampleEpisodes?: number | null;
  state: QueueItemState;
  progress: TProgress | null;
  error: string | null;
};

export function queueLines(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean)));
}

export function claimNextQueuedItem<TProgress>(queue: QueueItem<TProgress>[]): {
  queue: QueueItem<TProgress>[];
  next: QueueItem<TProgress> | null;
} {
  if (queue.some(item => item.state === "starting" || item.state === "processing")) {
    return { queue, next: null };
  }

  const next = queue.find(item => item.state === "queued");
  if (!next) return { queue, next: null };

  const claimed = { ...next, state: "starting" as const };
  return {
    queue: queue.map(item => (item.id === next.id ? claimed : item)),
    next: claimed,
  };
}

export function updateQueueItem<TProgress>(
  queue: QueueItem<TProgress>[],
  itemId: string,
  update: (item: QueueItem<TProgress>) => QueueItem<TProgress>,
): QueueItem<TProgress>[] {
  return queue.map(item => (item.id === itemId ? update(item) : item));
}
