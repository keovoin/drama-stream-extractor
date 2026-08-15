import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, Check, CircleAlert, Link2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ProgressState = {
  jobId: string;
  state: "processing" | "completed" | "failed";
  completed: number;
  total: number;
  error: string | null;
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

export default function Home() {
  const [url, setUrl] = useState("");
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const start = trpc.extract.start.useMutation();
  const advance = trpc.extract.advance.useMutation();
  const download = trpc.extract.download.useQuery(
    { jobId: progressState?.jobId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: progressState?.state === "completed", retry: false, refetchOnWindowFocus: false },
  );

  const progress = useMemo(() => {
    if (!progressState?.total) return 0;
    return Math.round((progressState.completed / progressState.total) * 100);
  }, [progressState]);

  useEffect(() => {
    if (!progressState || progressState.state !== "processing" || advance.isPending) return;
    const timer = window.setTimeout(() => {
      advance.mutate(
        { jobId: progressState.jobId },
        {
          onSuccess: next => setProgressState(current => current ? { ...current, ...next } : current),
          onError: error => setProgressState(current => current ? { ...current, state: "failed", error: error.message } : current),
        },
      );
    }, 550);
    return () => window.clearTimeout(timer);
  }, [advance, advance.isPending, progressState]);

  useEffect(() => {
    if (!download.data || downloaded) return;
    downloadWorkbook(download.data.base64, download.data.fileName);
    setDownloaded(true);
  }, [download.data, downloaded]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setProgressState(null);
    setDownloaded(false);
    try {
      const job = await start.mutateAsync({ url });
      setProgressState(job);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Please check the series URL and try again.");
    }
  };

  const isWorking = start.isPending || progressState?.state === "processing";
  const hasFailed = progressState?.state === "failed";
  const canDownload = progressState?.state === "completed" && Boolean(download.data);

  return (
    <div className="min-h-screen overflow-hidden bg-[#0d1017] text-[#f7f1e7]">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-10 sm:px-8 lg:px-12">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[#151a25]/90 shadow-[0_36px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="grid min-h-[620px] lg:grid-cols-[0.88fr_1.12fr]">
            <div className="relative hidden overflow-hidden border-r border-white/10 bg-[#111621] p-11 lg:block">
              <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(226,181,105,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(226,181,105,0.09)_1px,transparent_1px)] [background-size:36px_36px]" />
              <div className="relative flex h-full flex-col justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#e6b569]">Episode archive</p>
                  <h1 className="mt-6 max-w-sm font-serif text-5xl leading-[0.94] tracking-[-0.05em] text-[#f7f1e7]">Stream URLs,<br /><span className="text-[#d8aa63]">distilled.</span></h1>
                </div>
                <p className="max-w-xs border-l border-[#e2b569]/70 pl-5 text-sm leading-6 text-[#bfc3cb]">DramaBox is stable. iDrama is beta and may ask you to retry if the source site blocks verification. Both export to the same Excel workbook.</p>
              </div>
            </div>

            <div className="flex flex-col justify-center px-6 py-10 sm:px-11 lg:px-14">
              <div className="mx-auto w-full max-w-xl">
                <div className="mb-10 lg:hidden">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#e6b569]">Episode archive</p>
                  <h1 className="mt-4 font-serif text-4xl tracking-[-0.04em] text-[#f7f1e7]">Stream URLs, distilled.</h1>
                </div>
                <div className="mb-9">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d8aa63]">DramaBox stable · iDrama beta</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Create your episode workbook</h2>
                </div>

                <form onSubmit={submit} className="space-y-4">
                  <label htmlFor="series-url" className="sr-only">Series detail URL</label>
                  <div className="group flex items-center gap-3 rounded-2xl border border-white/12 bg-black/20 px-4 py-3 transition-colors focus-within:border-[#e2b569]/80 focus-within:bg-black/30">
                    <Link2 className="h-5 w-5 shrink-0 text-[#d8aa63]" aria-hidden="true" />
                    <Input id="series-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a DramaBox detail or iDrama watch URL" className="h-auto border-0 bg-transparent px-0 text-[15px] text-white shadow-none placeholder:text-[#717784] focus-visible:ring-0" disabled={isWorking} required />
                  </div>
                  <Button type="submit" disabled={isWorking || !url.trim()} className="h-12 w-full rounded-xl bg-[#e2b569] text-[15px] font-bold text-[#19140b] shadow-[0_12px_30px_rgba(226,181,105,0.18)] transition-all hover:bg-[#f1c780] hover:shadow-[0_16px_36px_rgba(226,181,105,0.26)] active:scale-[0.985] disabled:bg-[#6d624b]">
                    {isWorking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {isWorking ? "Extracting episodes" : "Extract stream URLs"}
                  </Button>
                </form>

                {(isWorking || hasFailed || canDownload || formError) && (
                  <div className="mt-8 border-t border-white/10 pt-7" aria-live="polite">
                    {isWorking && <><div className="mb-3 flex items-center justify-between text-sm"><span className="font-medium text-[#ece7dd]">{start.isPending && !progressState ? "Detecting episodes" : "Collecting stream URLs"}</span><span className="tabular-nums text-[#d8aa63]">{progressState ? `${progressState.completed} / ${progressState.total}` : "Preparing"}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#e2b569] transition-[width] duration-500" style={{ width: `${Math.max(progress, 4)}%` }} /></div></>}
                    {(formError || hasFailed) && <div className="flex items-start gap-3 rounded-xl border border-[#e58c81]/35 bg-[#e58c81]/10 p-4 text-sm text-[#ffd7d1]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{formError || progressState?.error}</p></div>}
                    {canDownload && <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3 text-sm text-[#e6eadf]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#9fcaa5]/15 text-[#a9d8af]"><Check className="h-4 w-4" /></span><span>Workbook ready.</span></div><Button type="button" onClick={() => downloadWorkbook(download.data!.base64, download.data!.fileName)} className="h-10 rounded-xl bg-white px-5 text-sm font-bold text-[#141820] hover:bg-[#f7f1e7] active:scale-[0.985]"><ArrowDownToLine className="h-4 w-4" />Download Excel</Button></div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
