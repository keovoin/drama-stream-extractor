import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  closeSeriesConnection,
  createWorkbookBase64,
  fetchEpisodeFromConnection,
  makeWorkbookFileName,
  openSeriesConnection,
  parseCompatibleSeriesUrl,
  replaceEpisodeResult,
  summarizeEpisodeResults,
  type EpisodeResult,
  type SeriesConnection,
} from "./dramaExtractor";

type ExtractionState = "processing" | "completed" | "failed";
type ExtractionMode = "initial" | "retry";

type ExtractionJob = {
  id: string;
  state: ExtractionState;
  completed: number;
  total: number;
  error: string | null;
  episodes: EpisodeResult[];
  connection: SeriesConnection | null;
  workbookBase64: string | null;
  fileName: string | null;
  sourceUrl: string;
  mode: ExtractionMode;
  runCompleted: number;
  runTotal: number;
  retryEpisodes: number[];
  revision: number;
};

const extractionJobs = new Map<string, ExtractionJob>();

function getJob(jobId: string): ExtractionJob {
  const job = extractionJobs.get(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "This extraction has expired. Please start again." });
  return job;
}

function progressResponse(job: ExtractionJob) {
  return {
    state: job.state,
    completed: job.completed,
    total: job.total,
    error: job.error,
    mode: job.mode,
    runCompleted: job.runCompleted,
    runTotal: job.runTotal,
    revision: job.revision,
    ...summarizeEpisodeResults(job.episodes),
  };
}

async function finishJob(job: ExtractionJob) {
  job.workbookBase64 = createWorkbookBase64(job.episodes);
  job.fileName = makeWorkbookFileName();
  job.state = "completed";
  await closeSeriesConnection(job.connection);
  job.connection = null;
}

async function failJob(job: ExtractionJob, error: unknown) {
  job.error = error instanceof Error ? error.message : "The extractor could not complete this request.";
  job.state = "failed";
  await closeSeriesConnection(job.connection);
  job.connection = null;
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  extract: router({
    start: publicProcedure
      .input(z.object({ url: z.string().trim().min(1).max(2_000) }))
      .mutation(async ({ input }) => {
        parseCompatibleSeriesUrl(input.url);
        const connection = await openSeriesConnection(input.url);
        const id = crypto.randomUUID();
        extractionJobs.set(id, {
          id,
          state: "processing",
          completed: 0,
          total: connection.total,
          error: null,
          episodes: [],
          connection,
          workbookBase64: null,
          fileName: null,
          sourceUrl: input.url,
          mode: "initial",
          runCompleted: 0,
          runTotal: connection.total,
          retryEpisodes: [],
          revision: 0,
        });
        return {
          jobId: id,
          completed: 0,
          total: connection.total,
          state: "processing" as const,
          error: null,
          mode: "initial" as const,
          runCompleted: 0,
          runTotal: connection.total,
          revision: 0,
          verified: 0,
          unavailable: 0,
        };
      }),
    advance: publicProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const job = getJob(input.jobId);
        if (job.state !== "processing" || !job.connection) {
          return progressResponse(job);
        }

        try {
          const nextEpisode = job.mode === "retry" ? job.retryEpisodes[job.runCompleted] : job.completed + 1;
          if (!nextEpisode) throw new Error("The retry queue did not contain another episode.");

          const result = await fetchEpisodeFromConnection(job.connection, nextEpisode);
          if (job.mode === "retry") {
            job.episodes = replaceEpisodeResult(job.episodes, result);
          } else {
            job.episodes.push(result);
            job.completed = nextEpisode;
          }
          job.runCompleted += 1;
          if (job.runCompleted === job.runTotal) await finishJob(job);
        } catch (error) {
          await failJob(job, error);
        }
        return progressResponse(job);
      }),
    retryFailed: publicProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const job = getJob(input.jobId);
        if (job.state !== "completed") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Wait for the current extraction to finish before retrying unavailable rows." });
        }

        const retryEpisodes = job.episodes.filter(episode => !episode.streamUrl).map(episode => episode.episode);
        if (retryEpisodes.length === 0) return progressResponse(job);

        const connection = await openSeriesConnection(job.sourceUrl);
        job.connection = connection;
        job.state = "processing";
        job.error = null;
        job.mode = "retry";
        job.runCompleted = 0;
        job.runTotal = retryEpisodes.length;
        job.retryEpisodes = retryEpisodes;
        job.revision += 1;
        job.workbookBase64 = null;
        job.fileName = null;
        return progressResponse(job);
      }),
    download: publicProcedure.input(z.object({ jobId: z.string().uuid(), revision: z.number().int().min(0).optional() })).query(({ input }) => {
      const job = getJob(input.jobId);
      if (job.state !== "completed" || !job.workbookBase64 || !job.fileName) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The Excel file is not ready yet." });
      }
      return { fileName: job.fileName, base64: job.workbookBase64 };
    }),
  }),

});

export type AppRouter = typeof appRouter;
