import { describe, expect, it } from 'vitest';
import { parseDuoTurns, splitWav } from '@/lib/ai/gemini-tts';

describe('parseDuoTurns (Gemini 3.8)', () => {
  it('separa turnos, tira cues pro estilo e junta continuação', () => {
    const turns = parseDuoTurns(
      [
        'Ana: (animada) bom dia, galera do Time Campanha AC!',
        '(rindo) Beto: e que semana, hein?',
        'teve muita coisa.',
        '',
        'ana: (surpresa) sério?',
      ].join('\n'),
      ['Ana', 'Beto'],
    );
    expect(turns).toEqual([
      { speaker: 'Ana', text: 'bom dia, galera do Time Campanha AC!', cues: ['animada'] },
      { speaker: 'Beto', text: 'e que semana, hein? teve muita coisa.', cues: ['rindo'] },
      { speaker: 'Ana', text: 'sério?', cues: ['surpresa'] },
    ]);
  });
});

describe('splitWav', () => {
  it('extrai PCM e sample rate do RIFF', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(40, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
    h.write('data', 36); h.writeUInt32LE(4, 40);
    const out = splitWav(Buffer.concat([h, pcm]));
    expect(out.sampleRate).toBe(24000);
    expect([...out.pcm]).toEqual([1, 2, 3, 4]);
  });
  it('trata buffer sem header como PCM cru', () => {
    expect(splitWav(Buffer.from([9, 9])).pcm.length).toBe(2);
  });
});
