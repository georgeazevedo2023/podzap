import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mixWithBackgroundMusic } from '../lib/audios/mix';

async function main() {
  const voice = await readFile(path.join(process.cwd(), 'voice-smoke.wav'));
  const musicPath = path.join(process.cwd(), 'assets', 'podcast-music.mp3');
  const out = await mixWithBackgroundMusic(voice, { musicPath });
  await writeFile(path.join(process.cwd(), 'mixed-smoke.wav'), out.mixed);
  console.log(
    JSON.stringify({
      durationSeconds: out.durationSeconds,
      sizeBytes: out.mixed.byteLength,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
