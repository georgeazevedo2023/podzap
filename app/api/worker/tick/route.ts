/**
 * `POST /api/worker/tick` — substituto HTTP dos 3 crons Inngest, chamado
 * pelo workflow n8n "Every 30s → Tick podzap" a cada 30 segundos.
 *
 * Os workers Inngest event-driven (`transcribe-audio`, `generate-summary`,
 * `generate-tts`, `deliver-to-whatsapp`) continuam registrados e reagindo
 * a eventos disparados via `inngest.send()` nos endpoints HTTP. Só os 3
 * cron workers migraram pra n8n:
 *
 *   - run-schedules           → `dueSchedulesNow()` + emit `summary.requested`
 *   - retry-pending-downloads → reaper de `media_download_status='pending'`
 *   - transcription-retry     → reaper de áudio/imagem sem transcript
 *
 * Auth: Bearer token via header `Authorization: Bearer $WORKER_TICK_TOKEN`.
 * Se `WORKER_TICK_TOKEN` não estiver setada, o endpoint retorna 503
 * (service-not-configured) — nunca roda sem auth, mesmo em dev.
 *
 * Resposta: JSON com o resultado de cada task. n8n está configurado com
 * `neverError: true`, então erros em tasks individuais não quebram o
 * workflow; eles aparecem no response body pra debug.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  runSchedulesHandler,
  type RunSchedulesResult,
} from "@/inngest/functions/run-schedules";
import {
  retryPendingDownloadsHandler,
  type RetryPendingResult,
} from "@/inngest/functions/retry-pending";
import {
  transcriptionRetryHandler,
  type TranscriptionRetryResult,
} from "@/inngest/functions/transcription-retry";

export const runtime = "nodejs";
// Crons não têm cache; Next pode optimizar de cache/ISR se não marcado.
export const dynamic = "force-dynamic";

// Adapter minimal pra passar `runXHandler` sem depender da Inngest runtime.
// Inline tudo — no retry de step, no replay, a semântica de cron-tick não
// precisa disso (se falhar, o próximo tick em 30s tenta de novo).
const inlineStep = {
  run: async <T>(_name: string, fn: () => Promise<T> | T) => fn(),
};

type TaskStatus =
  | { ok: true; name: string; durationMs: number; result: unknown }
  | { ok: false; name: string; durationMs: number; error: string };

function tickLogger(name: string) {
  return {
    info: (msg: string, meta?: Record<string, unknown>) =>
      console.log(`[tick:${name}] ${msg}`, meta ?? ""),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      console.warn(`[tick:${name}] ${msg}`, meta ?? ""),
    error: (msg: string, meta?: Record<string, unknown>) =>
      console.error(`[tick:${name}] ${msg}`, meta ?? ""),
  };
}

async function runTask<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<TaskStatus> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      ok: true,
      name,
      durationMs: Date.now() - startedAt,
      result: result as unknown,
    };
  } catch (err) {
    return {
      ok: false,
      name,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.WORKER_TICK_TOKEN;
  if (!expected) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: "WORKER_TICK_TOKEN env var not set — refusing to run unauthenticated.",
        },
      },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or missing Bearer token." } },
      { status: 401 },
    );
  }

  const startedAt = Date.now();

  // Todas as 3 tasks rodam em paralelo — são independentes entre si
  // (schedulers olham `schedules`, retry-pending olha `messages.pending`,
  // transcription-retry olha `messages.downloaded` sem transcript). Se uma
  // falhar, as outras completam; o response mostra qual falhou.
  const [schedules, retryPending, transcriptionRetry] = await Promise.all([
    runTask<RunSchedulesResult>("run-schedules", () =>
      runSchedulesHandler({ step: inlineStep, logger: tickLogger("run-schedules") }),
    ),
    runTask<RetryPendingResult>("retry-pending-downloads", () =>
      retryPendingDownloadsHandler({
        step: inlineStep,
        logger: tickLogger("retry-pending-downloads"),
      }),
    ),
    runTask<TranscriptionRetryResult>("transcription-retry", () =>
      transcriptionRetryHandler({
        step: inlineStep,
        logger: tickLogger("transcription-retry"),
      }),
    ),
  ]);

  const totalMs = Date.now() - startedAt;
  const tasks = [schedules, retryPending, transcriptionRetry];
  const allOk = tasks.every((t) => t.ok);

  return NextResponse.json(
    {
      ok: allOk,
      totalMs,
      tasks,
    },
    { status: allOk ? 200 : 207 }, // 207 = Multi-Status: alguns falharam
  );
}

/**
 * GET só pra probe/health (ex: Uptime Robot). Não roda as tasks.
 */
export async function GET(): Promise<NextResponse> {
  const configured = Boolean(process.env.WORKER_TICK_TOKEN);
  return NextResponse.json({
    ok: true,
    configured,
    info: configured
      ? "POST with Bearer token to run periodic tasks."
      : "WORKER_TICK_TOKEN not set.",
  });
}
