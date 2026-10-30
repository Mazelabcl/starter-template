// src/research.js
// Wrapper sobre src/openrouter_client.js especializado en Perplexity (Sonar).
// La API pública (`research(modelKey, question, opts)` + CLI) se mantiene 1:1
// para no romper consumidores existentes (smoke test check 5, cualquier código
// que dependa del shape `{content, model, usage, citations}`).

// Carga .env explícita vía el helper interno. Sin esto, invocar el script con
// `node src/research.js ...` directo (sin npm run) no veía las API keys del .env.
// El helper es idempotente — importarlo varias veces no duplica trabajo.
import './load_env.js';

// El guard de OPENROUTER_API_KEY solo aplica cuando este archivo se ejecuta como
// CLI. Importarlo como librería (ej. desde tests o módulos consumidores) no debe
// matar el proceso — el `chat()` interno ya falla con error claro si la key falta.

import { chat, MODELS, OpenRouterError } from './openrouter_client.js';

// Mapa de aliases del CLI/legacy a entradas del catálogo unificado.
// Mantiene compatibilidad: `research('quick', q)` sigue funcionando exactamente
// como antes.
const KEY_TO_MODEL = {
  quick:  MODELS.perplexity.sonar,
  pro:    MODELS.perplexity.sonar_pro,
  search: MODELS.perplexity.sonar_pro_search,
  reason: MODELS.perplexity.sonar_reasoning_pro,
  deep:   MODELS.perplexity.sonar_deep_research,
};

// Timeouts por modo. `deep` (sonar-deep-research) tarda varios minutos de forma
// rutinaria; con el default de chat() (120s) siempre abortaba. El caller puede
// pasar `opts.timeout_ms` para override; el CLI acepta `--timeout-ms=N` o la
// variable de entorno RESEARCH_TIMEOUT_MS.
export const DEEP_TIMEOUT_MS = 300_000;
const TIMEOUT_BY_KEY = { deep: DEEP_TIMEOUT_MS, reason: DEEP_TIMEOUT_MS };

export function defaultTimeoutFor(modelKey) {
  return TIMEOUT_BY_KEY[modelKey];
}

// Extrae las URLs de fuentes de una respuesta de Perplexity vía OpenRouter.
// Verificado 2026-10 con perplexity/sonar: OpenRouter NO devuelve `citations`
// top-level; las fuentes vienen en `choices[0].message.annotations[]` con
// `{ type: 'url_citation', url_citation: { url, title } }`. Cubrimos también
// `citations` (shape antiguo / API directa de Perplexity) y `search_results`.
// Devuelve { citations: string[] (URLs, sin duplicados), sources: [{url, title}] }.
export function extractCitations(raw) {
  const sources = [];
  const seen = new Set();
  const push = (url, title) => {
    if (typeof url !== 'string' || !url.trim() || seen.has(url)) return;
    seen.add(url);
    sources.push({ url, title: typeof title === 'string' ? title : '' });
  };
  if (!raw || typeof raw !== 'object') return { citations: [], sources };

  const annotations = raw.choices?.[0]?.message?.annotations;
  if (Array.isArray(annotations)) {
    for (const a of annotations) {
      const c = a?.url_citation ?? a;
      push(c?.url, c?.title);
    }
  }
  if (Array.isArray(raw.citations)) {
    for (const c of raw.citations) {
      if (typeof c === 'string') push(c, '');
      else push(c?.url, c?.title);
    }
  }
  if (Array.isArray(raw.search_results)) {
    for (const r of raw.search_results) push(r?.url, r?.title);
  }
  return { citations: sources.map(s => s.url), sources };
}

export async function research(modelKey, question, opts = {}) {
  const model = KEY_TO_MODEL[modelKey] ?? KEY_TO_MODEL.pro;
  const defaultTimeout = defaultTimeoutFor(modelKey);
  let result;
  try {
    result = await chat({
      model,
      messages: [{ role: 'user', content: question }],
      ...(defaultTimeout ? { timeout_ms: defaultTimeout } : {}),
      ...opts,
    });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      // Re-throw como Error plano para mantener compatibilidad con el shape
      // histórico del módulo (los consumidores esperan Error.message tipo
      // "OpenRouter 401: ..." sin instancia custom).
      throw new Error(e.message);
    }
    throw e;
  }

  // `citations` mantiene el shape histórico (array de URLs). `sources` suma títulos.
  const { citations, sources } = extractCitations(result.raw ?? { citations: result.citations });

  return {
    content: result.content ?? '',
    model: result.model_used,
    usage: result.usage,
    citations,
    sources,
  };
}

// Lee el override de timeout del CLI: `--timeout-ms=N` / `--timeout-ms N` o env
// RESEARCH_TIMEOUT_MS. Devuelve { timeout_ms?, rest } con el flag removido.
export function parseCliArgs(argv) {
  const rest = [];
  let timeout_ms;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const m = a.match(/^--timeout-ms(?:=(.*))?$/);
    if (m) {
      const val = m[1] !== undefined ? m[1] : argv[++i];
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) timeout_ms = n;
      continue;
    }
    rest.push(a);
  }
  if (timeout_ms === undefined && process.env.RESEARCH_TIMEOUT_MS) {
    const n = Number(process.env.RESEARCH_TIMEOUT_MS);
    if (Number.isFinite(n) && n > 0) timeout_ms = n;
  }
  return { timeout_ms, rest };
}

// CLI: detecta si este archivo se está ejecutando directamente (cross-platform Windows/Unix)
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Falta OPENROUTER_API_KEY. Corre `npm run setup` o usa `/setup-openrouter` en Claude Code.');
    process.exit(1);
  }
  const { timeout_ms, rest: args } = parseCliArgs(process.argv.slice(2));
  const [modelKey = 'pro', ...rest] = args;
  const question = rest.join(' ');
  if (!question) {
    console.error('Uso: node src/research.js <quick|pro|search|reason|deep> "<pregunta>" [--timeout-ms=600000]');
    console.error('  deep/reason usan 300000 ms (5 min) por defecto; quick/pro/search usan 120000 ms.');
    process.exit(1);
  }
  research(modelKey, question, timeout_ms ? { timeout_ms } : {})
    .then(({ content, model, sources }) => {
      console.log(`\n=== ${model} ===\n`);
      console.log(content);
      if (sources?.length) {
        console.log('\n--- Fuentes ---');
        sources.forEach((s, i) => console.log(`[${i + 1}] ${s.title ? `${s.title} — ` : ''}${s.url}`));
      }
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
