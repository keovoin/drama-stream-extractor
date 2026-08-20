import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { claimNextQueuedItem, queueLines, updateQueueItem, type QueueItem } from "@/lib/queueOrchestrator";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, Check, CircleAlert, Link2, LoaderCircle, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ProgressState = {
  jobId: string;
  state: "processing" | "completed" | "failed";
  completed: number;
  total: number;
  error: string | null;
  mode: "initial" | "retry";
  runCompleted: number;
  runTotal: number;
  revision: number;
  verified: number;
  unavailable: number;
  title: string;
  sourceTotal: number;
  sampleEpisodeLimit: number | null;
};

function downloadWorkbook(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function queueTitleFromUrl(rawUrl: string): string {
  try {
    const slug = new URL(rawUrl).searchParams.get("slug")?.trim();
    if (!slug) return "Preparing series";
    return slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  } catch {
    return "Preparing series";
  }
}

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [queue, setQueue] = useState<QueueItem<ProgressState>[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [quickSample, setQuickSample] = useState(true);
  const start = trpc.extract.start.useMutation();
  const advance = trpc.extract.advance.useMutation();
  const retryFailed = trpc.extract.retryFailed.useMutation();
  const utils = trpc.useUtils();

  const activeItem = useMemo(() => queue.find(item => item.state === "starting" || item.state === "processing") ?? null, [queue]);
  const queuedCount = useMemo(() => queue.filter(item => item.state === "queued").length, [queue]);
  const completeCount = useMemo(() => queue.filter(item => item.state === "completed").length, [queue]);
  const activeProgress = activeItem?.progress ?? null;
  const retryingRows = activeProgress?.state === "processing" && activeProgress.mode === "retry";
  const visibleCompleted = retryingRows ? activeProgress?.runCompleted : activeProgress?.completed;
  const visibleTotal = retryingRows ? activeProgress?.runTotal : activeProgress?.total;
  const progressPercent = visibleTotal ? Math.max(4, Math.round(((visibleCompleted ?? 0) / visibleTotal) * 100)) : 4;

  useEffect(() => {
    if (activeItem || start.isPending) return;
    const claim = claimNextQueuedItem(queue);
    const nextItem = claim.next;
    if (!nextItem) return;

    setQueue(claim.queue);
    start.mutate(
      { url: nextItem.url, sampleEpisodes: nextItem.sampleEpisodes ?? undefined },
      {
        onSuccess: job => setQueue(current => updateQueueItem(current, nextItem.id, item => ({ ...item, state: "processing", progress: job, error: null }))),
        onError: error => setQueue(current => updateQueueItem(current, nextItem.id, item => ({ ...item, state: "failed", error: error.message }))),
      },
    );
  }, [activeItem, queue, start, start.isPending]);

  useEffect(() => {
    if (!activeItem?.progress || activeItem.progress.state !== "processing" || advance.isPending) return;
    const timer = window.setTimeout(() => {
      advance.mutate(
        { jobId: activeItem.progress!.jobId },
        {
          onSuccess: next => setQueue(current => updateQueueItem(current, activeItem.id, item => {
            if (item.id !== activeItem.id || !item.progress) return item;
            return { ...item, state: next.state, progress: { ...item.progress, ...next }, error: next.error };
          })),
          onError: error => setQueue(current => updateQueueItem(current, activeItem.id, item => ({ ...item, state: "failed", error: error.message }))),
        },
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeItem, advance, advance.isPending]);

  const addToQueue = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const links = queueLines(urlInput);
    if (links.length === 0) {
      setFormError("Paste one or more DramaBox series-detail or iDrama watch URLs, one per line.");
      return;
    }
    setQueue(current => {
      const existing = new Set(current.map(item => item.url));
      const additions = links.filter(link => !existing.has(link)).map(link => ({ id: crypto.randomUUID(), url: link, sampleEpisodes: quickSample ? 3 : null, state: "queued" as const, progress: null, error: null }));
      return [...current, ...additions];
    });
    setUrlInput("");
    setFormError(null);
  };

  const downloadItem = async (item: QueueItem<ProgressState>) => {
    if (!item.progress) return;
    try {
      const workbook = await utils.extract.download.fetch({ jobId: item.progress.jobId, revision: item.progress.revision });
      downloadWorkbook(workbook.base64, workbook.fileName);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The workbook could not be downloaded. Please try again.");
    }
  };

  const retryItem = async (item: QueueItem<ProgressState>) => {
    if (!item.progress || activeItem) return;
    setFormError(null);
    try {
      const next = await retryFailed.mutateAsync({ jobId: item.progress.jobId });
      setQueue(current => updateQueueItem(current, item.id, currentItem => ({ ...currentItem, state: "processing", progress: { ...currentItem.progress!, ...next }, error: null })));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The unavailable rows could not be retried. Please try again.");
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#0d1017] text-[#f7f1e7]">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-10 sm:px-8 lg:px-12">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[#151a25]/90 shadow-[0_36px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="grid min-h-[620px] lg:grid-cols-[0.88fr_1.12fr]">
            <div className="relative hidden overflow-hidden border-r border-white/10 bg-[#111621] p-11 lg:block">
              <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(226,181,105,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(226,181,105,0.09)_1px,transparent_1px)] [background-size:36px_36px]" />
              <div className="relative flex h-full flex-col justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#e6b569]">Episode archive</p><h1 className="mt-6 max-w-sm font-serif text-5xl leading-[0.94] tracking-[-0.05em] text-[#f7f1e7]">Stream URLs,<br /><span className="text-[#d8aa63]">distilled.</span></h1></div><p className="max-w-xs border-l border-[#e2b569]/70 pl-5 text-sm leading-6 text-[#bfc3cb]">Paste several supported links and the active queue finishes one series before starting the next. Keep this browser tab open while it works.</p></div>
            </div>
            <div className="flex flex-col justify-center px-6 py-10 sm:px-11 lg:px-14"><div className="mx-auto w-full max-w-xl">
              <div className="mb-9"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d8aa63]">DramaBox · DramaWave · iDrama beta</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Queue your episode workbooks</h2></div>
              <form onSubmit={addToQueue} className="space-y-4"><label htmlFor="series-urls" className="sr-only">Series URLs</label><div className="rounded-2xl border border-white/12 bg-black/20 px-4 py-3 transition-colors focus-within:border-[#e2b569]/80 focus-within:bg-black/30"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#d8aa63]"><Link2 className="h-4 w-4" />One supported link per line</div><Textarea id="series-urls" value={urlInput} onChange={event => setUrlInput(event.target.value)} placeholder="Paste DramaBox or DramaWave detail URLs, or iDrama watch URLs" className="min-h-28 border-0 bg-transparent px-0 py-0 text-[15px] text-white shadow-none placeholder:text-[#717784] focus-visible:ring-0" /></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e2b569]/30 bg-[#e2b569]/[0.07] px-4 py-3 text-sm text-[#e9dfcf]"><input type="checkbox" checked={quickSample} onChange={event => setQuickSample(event.target.checked)} className="h-4 w-4 accent-[#e2b569]" /><span><span className="font-semibold text-[#f3d39a]">Quick test</span> · collect only the first 3 episodes, then export immediately</span></label><p className="text-xs leading-5 text-[#8d93a0]">Turn off Quick test when you are ready to collect every episode. The queue works in this open tab. ShortWave links are gated; DramaFren watch pages are single embeds.</p><Button type="submit" disabled={!urlInput.trim()} className="h-12 w-full rounded-xl bg-[#e2b569] text-[15px] font-bold text-[#19140b] shadow-[0_12px_30px_rgba(226,181,105,0.18)] transition-all hover:bg-[#f1c780] hover:shadow-[0_16px_36px_rgba(226,181,105,0.26)] active:scale-[0.985] disabled:bg-[#6d624b]"><ListChecks className="h-4 w-4" />Add {queueLines(urlInput).length > 1 ? `${queueLines(urlInput).length} series` : "series"} to queue</Button></form>
              {(activeItem || queue.length > 0 || formError) && <div className="mt-8 border-t border-white/10 pt-7" aria-live="polite"><div className="mb-4 flex items-center justify-between text-sm text-[#bfc3cb]"><span>{activeItem ? "Processing queue" : "Queue complete"}</span><span className="tabular-nums text-[#d8aa63]">{completeCount} complete · {queuedCount} waiting</span></div>{activeItem && <div className="mb-5"><div className="mb-3 flex items-center justify-between text-sm"><span className="font-medium text-[#ece7dd]">{retryingRows ? "Retrying unavailable stream URLs" : activeItem.progress?.sampleEpisodeLimit ? `Quick test · first ${activeItem.progress.sampleEpisodeLimit} episodes` : "Collecting stream URLs"} · {activeItem.progress?.title || queueTitleFromUrl(activeItem.url)}</span><span className="tabular-nums text-[#d8aa63]">{visibleCompleted} / {visibleTotal}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#e2b569] transition-[width] duration-500" style={{ width: `${progressPercent}%` }} /></div></div>}{formError && <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#e58c81]/35 bg-[#e58c81]/10 p-4 text-sm text-[#ffd7d1]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{formError}</p></div>}<div className="space-y-2">{queue.map((item, index) => <div key={item.id} className="rounded-xl border border-white/10 bg-black/15 px-4 py-3"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/8 text-xs font-bold text-[#d8aa63]">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[#ece7dd]">{item.progress?.title || queueTitleFromUrl(item.url)}</p><p className="mt-1 text-xs text-[#8d93a0]">{item.state === "queued" && `Waiting for earlier series${item.sampleEpisodes ? ` · quick test (${item.sampleEpisodes} episodes)` : ""}`}{item.state === "starting" && "Opening source session"}{item.state === "processing" && "Extracting"}{item.state === "failed" && (item.error || "Could not start this series")}{item.state === "completed" && `${item.progress?.verified ?? 0} URLs captured${item.progress?.unavailable ? ` · ${item.progress.unavailable} unavailable` : ""}${item.progress?.sampleEpisodeLimit ? ` · quick test (${item.progress.total} of ${item.progress.sourceTotal})` : ""}`}</p></div>{item.state === "completed" && item.progress && <div className="flex shrink-0 gap-2"><Button type="button" size="sm" onClick={() => downloadItem(item)} className="h-8 rounded-lg bg-white px-3 text-xs font-bold text-[#141820] hover:bg-[#f7f1e7]"><ArrowDownToLine className="h-3.5 w-3.5" />Excel</Button>{Boolean(item.progress.unavailable) && <Button type="button" size="sm" variant="outline" disabled={Boolean(activeItem) || retryFailed.isPending} onClick={() => retryItem(item)} className="h-8 rounded-lg border-[#e2b569]/60 bg-transparent px-3 text-xs font-bold text-[#f3d39a] hover:bg-[#e2b569]/10">Retry failed</Button>}</div>}{(item.state === "starting" || item.state === "processing") && <LoaderCircle className="mt-1 h-4 w-4 shrink-0 animate-spin text-[#d8aa63]" />}{item.state === "completed" && <Check className="mt-1 h-4 w-4 shrink-0 text-[#a9d8af]" />}</div></div>)}</div></div>}
            </div></div>
          </div>
        </section>
      </main>
    </div>
  );
}
