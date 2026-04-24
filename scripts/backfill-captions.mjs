#!/usr/bin/env node
/**
 * Backfill de captions pra summaries antigas (pré-prompt v6).
 *
 * Pega rows com `caption is null` e gera uma legenda emoji-rich a partir
 * do `text` já aprovado. NÃO regenera o texto — só preenche o campo
 * faltante. Idempotente (após rodar, próxima execução não acha rows).
 *
 * Uso:
 *   node --env-file=.env.local scripts/backfill-captions.mjs            # roda
 *   node --env-file=.env.local scripts/backfill-captions.mjs --dry-run  # só lista
 *   node --env-file=.env.local scripts/backfill-captions.mjs --limit=2  # cap N
 *
 * Requer: GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');
const limitArg = [...args].find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) || 50 : 50;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_KEY) {
  console.error(
    '[backfill] missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY',
  );
  process.exit(1);
}

const CAPTION_PROMPT = (groupName, text) => `
Você gera legendas emoji-rich pra acompanhar episódios de podcast no WhatsApp.

REGRAS:
- TEASER curto de 4-7 linhas, emoji-rich, chamativo
- NÃO é resumo do conteúdo — é HYPE pro usuário querer escutar
- Mencione o grupo pelo nome no máximo uma vez (opcional)
- NÃO cite participantes, NÃO dê spoilers específicos
- Estrutura: abertura chamativa + subtítulo curto + 2-3 bullets com "> " + fecho curto
- Use emojis comuns (🎙 🔥 💬 📊 ✨ 🎧) — markdown *bold*/_italic_ não vale

EXEMPLO DO FORMATO:

🎙 A HORA MAIS AGUARDADA DO DIA CHEGOU! 🎙

✨Nosso PODCAST Diário✨

> 🔥 Tudo que rolou de mais importante no grupo hoje
> 💬 As melhores discussões e insights
> 📊 Resumo completo para quem perdeu alguma coisa

A gente te atualiza em poucos minutos!

---

Grupo: ${groupName ?? 'sem nome'}

Roteiro do podcast (use só pra ENTENDER os temas, não cite literalmente):
${text.slice(0, 4000)}

Retorne APENAS JSON:
{ "caption": "<legenda no formato exato do exemplo, com \\n>" }
`.trim();

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const gemini = new GoogleGenAI({ apiKey: GEMINI_KEY });

async function generateCaption(text, groupName) {
  const model = process.env.GEMINI_LLM_MODEL_FAST ?? 'gemini-2.5-flash';
  const response = await gemini.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: CAPTION_PROMPT(groupName, text) }] }],
    config: {
      temperature: 0.8,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: { caption: { type: Type.STRING } },
        required: ['caption'],
      },
    },
  });

  const raw = response.text ?? '';
  const parsed = JSON.parse(raw);
  if (typeof parsed.caption !== 'string' || parsed.caption.trim().length === 0) {
    throw new Error('Gemini returned empty caption');
  }
  return parsed.caption.trim();
}

async function main() {
  const { data: rows, error } = await supabase
    .from('summaries')
    .select('id, text, groups:group_id ( name ), created_at, prompt_version')
    .is('caption', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error('[backfill] query failed:', error.message);
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log('[backfill] nada pra fazer — todas as summaries têm caption.');
    return;
  }

  console.log(`[backfill] ${rows.length} rows sem caption${isDryRun ? ' (DRY-RUN)' : ''}\n`);

  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    const groupName = Array.isArray(row.groups)
      ? row.groups[0]?.name
      : row.groups?.name;
    const labelDate = row.created_at?.slice(0, 10) ?? '?';
    process.stdout.write(
      `  ${row.id}  ${labelDate}  v=${row.prompt_version ?? '?'}  group="${groupName ?? '?'}"  ... `,
    );

    if (isDryRun) {
      console.log('skip (dry-run)');
      continue;
    }

    try {
      const caption = await generateCaption(row.text, groupName);
      const { error: updErr } = await supabase
        .from('summaries')
        .update({ caption })
        .eq('id', row.id);
      if (updErr) throw new Error(`update failed: ${updErr.message}`);
      console.log(`OK (${caption.length} chars)`);
      ok += 1;
    } catch (err) {
      console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
      fail += 1;
    }
  }

  console.log(`\n[backfill] done — ok=${ok} fail=${fail}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
