/**
 * Mixa voz + música de fundo em um único WAV via ffmpeg.
 *
 * Layout do áudio final:
 *   [0s .. introSeconds)          música no volume cheio
 *   [introSeconds .. voice_end)   voz sobre a música loopada, com ducking
 *                                  (sidechaincompress reduz a música enquanto
 *                                  a voz fala e solta de volta nos silêncios)
 *   [voice_end .. voice_end+1s)   fade out da música pra não cortar seco
 *
 * A música loopa infinitamente (`-stream_loop -1`) e o `-t` do output
 * limita a duração total, então arquivos de trilha de qualquer tamanho
 * funcionam.
 *
 * Se ffmpeg não estiver instalado ou falhar, o caller (`createAudioForSummary`)
 * faz fallback pra voz pura — a música é enhancement, não requisito.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export class MixError extends Error {
  constructor(
    public code: 'FFMPEG_NOT_FOUND' | 'FFMPEG_FAILED' | 'IO_ERROR',
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'MixError';
  }
}

export interface MixOptions {
  /** Quantos segundos a música toca sozinha antes da voz. Default 3. */
  introSeconds?: number;
  /** Fade out final em segundos. Default 1. */
  fadeOutSeconds?: number;
  /** Caminho absoluto do MP3/WAV da trilha. */
  musicPath: string;
}

export interface MixResult {
  mixed: Buffer;
  durationSeconds: number;
}

const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';

/**
 * Probe a duração do WAV da voz.
 *
 * Gemini TTS passa por `pcmToWav` em `lib/ai/gemini-tts.ts`, que produz um
 * header fixo de 44 bytes (RIFF + fmt + data, sem LIST/INFO). Aqui mesmo
 * assim scanamos os chunks até achar "data" — é barato e nos protege de
 * WAVs gerados por outras ferramentas (testes, eventual reprocessamento).
 */
function voiceWavDurationSeconds(voiceWav: Buffer): number {
  if (voiceWav.length < 44 || voiceWav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new MixError('IO_ERROR', 'Voice buffer is not a RIFF/WAV');
  }
  if (voiceWav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new MixError('IO_ERROR', 'Missing WAVE marker');
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  // Chunks after the 12-byte RIFF header: each is 4 bytes id + 4 bytes LE size
  // + payload (padded to even). Walk until we've captured fmt + data.
  let offset = 12;
  while (offset + 8 <= voiceWav.length) {
    const id = voiceWav.toString('ascii', offset, offset + 4);
    const size = voiceWav.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    if (id === 'fmt ') {
      channels = voiceWav.readUInt16LE(payloadStart + 2);
      sampleRate = voiceWav.readUInt32LE(payloadStart + 4);
      bitsPerSample = voiceWav.readUInt16LE(payloadStart + 14);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }
    // Chunks are word-aligned (pad byte when size is odd).
    offset = payloadStart + size + (size % 2);
  }

  const bytesPerSample = (bitsPerSample / 8) * channels;
  if (sampleRate <= 0 || bytesPerSample <= 0 || dataSize <= 0) {
    throw new MixError('IO_ERROR', 'Invalid WAV header on voice buffer');
  }
  return dataSize / bytesPerSample / sampleRate;
}

/**
 * Roda ffmpeg no caminho do PATH (ou `FFMPEG_BIN`) com os args dados.
 * Captura stderr pra mensagens de erro úteis.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new MixError(
            'FFMPEG_NOT_FOUND',
            `ffmpeg binary not found (tried: ${FFMPEG_BIN})`,
            err,
          ),
        );
        return;
      }
      reject(new MixError('FFMPEG_FAILED', err.message, err));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderr.trim().split('\n').slice(-10).join('\n');
      reject(
        new MixError(
          'FFMPEG_FAILED',
          `ffmpeg exited with code ${code}: ${tail}`,
        ),
      );
    });
  });
}

/**
 * Mixa voz (WAV PCM 24kHz mono — o que Gemini TTS produz) com a trilha
 * loopada, aplicando intro + ducking + fade out. Retorna WAV mono 24kHz
 * 16-bit PCM (mesmo formato da entrada — sobe no Storage como `audio/wav`).
 */
export async function mixWithBackgroundMusic(
  voiceWav: Buffer,
  opts: MixOptions,
): Promise<MixResult> {
  const intro = opts.introSeconds ?? 3;
  const fadeOut = opts.fadeOutSeconds ?? 1;
  const voiceDuration = voiceWavDurationSeconds(voiceWav);
  const totalDuration = intro + voiceDuration + fadeOut;
  const fadeStart = Math.max(0, totalDuration - fadeOut);

  // Work dir temporário — ffmpeg lida bem com pipes, mas 2 inputs binários
  // (arquivo + stdin) + output em stdout no Windows tem quirks. Temp files
  // são 100% confiáveis e o custo (~ms) é irrelevante perto da chamada TTS.
  const workDir = await mkdtemp(path.join(tmpdir(), 'podzap-mix-'));
  const voicePath = path.join(workDir, 'voice.wav');
  const outPath = path.join(workDir, 'mixed.wav');

  try {
    await writeFile(voicePath, voiceWav);

    // Filter graph:
    //   [0] música → resample 24kHz mono (match da voz) → [bgm]
    //   [1] voz → delay intro*1000ms → apad até totalDuration (pad de silêncio
    //            no final pra não cortar o fade out curto demais) → split em
    //            [vmix] (pra mix final) e [vsc] (pra sidechain)
    //   [bgm][vsc] sidechaincompress (duck a música quando a voz fala)
    //             → afade out no final → [bgm_out]
    //   [bgm_out][vmix] amix → [out]
    //
    // sidechaincompress: threshold 0.05 (voz acima de ~-26dB dispara),
    // ratio 8 (redução agressiva pra música não competir), attack 50ms
    // (abaixa rápido no começo da fala), release 400ms (sobe suave no silêncio).
    // makeup 1 é o default/no-op (ffmpeg rejeita 0 — range [1, 64]); o ducking
    // vem do ratio + threshold, não do makeup gain.
    //
    // apad com whole_dur é necessário porque sem ele o amix `duration=first`
    // acaba com o input mais curto (a voz terminaria em intro+voice, cortando
    // o fade out do último segundo).
    const introMs = Math.round(intro * 1000);
    const totalStr = totalDuration.toFixed(3);
    const filter = [
      `[0:a]aformat=sample_rates=24000:channel_layouts=mono,volume=0.55[bgm]`,
      `[1:a]adelay=${introMs}|${introMs},apad=whole_dur=${totalStr}[vpad]`,
      `[vpad]asplit=2[vmix][vsc]`,
      `[bgm][vsc]sidechaincompress=threshold=0.05:ratio=8:attack=50:release=400:makeup=1[ducked]`,
      `[ducked]afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOut}[bgm_out]`,
      `[bgm_out][vmix]amix=inputs=2:duration=first:dropout_transition=0,aformat=sample_fmts=s16:sample_rates=24000:channel_layouts=mono[out]`,
    ].join(';');

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-stream_loop', '-1',
      '-i', opts.musicPath,
      '-i', voicePath,
      '-filter_complex', filter,
      '-map', '[out]',
      '-t', totalDuration.toFixed(3),
      '-ac', '1',
      '-ar', '24000',
      '-c:a', 'pcm_s16le',
      outPath,
    ];

    await runFfmpeg(args);
    const mixed = await readFile(outPath);
    return { mixed, durationSeconds: totalDuration };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      /* ignore cleanup errors */
    });
  }
}
