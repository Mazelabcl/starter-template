// src/research.js
// Wrapper sobre src/openrouter_client.js especializado en Perplexity (Sonar).
// La API pública (`research(modelKey, question, opts)` + CLI) se mantiene 1:1
// para no romper consumidores existentes (smoke test check 5, cualquier código
// que dependa del shape `{content, model, usage, citations}`).

// Carga dotenv con manejo de error explícito si falta la dependencia.
// Esto pasa cuando alguien clona el repo y olvida correr `npm install`.
try {
  await import('dotenv/config');
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package 'dotenv'/.test(err.message)) {
    console.error("❌ Falta dependencia 'dotenv'. Corre: npm install");
    process.exit(1);
  }
  throw err;
}

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

export async function research(modelKey, question, opts = {}) {
  const model = KEY_TO_MODEL[modelKey] ?? KEY_TO_MODEL.pro;
  let result;
  try {
    result = await chat({
      model,
      messages: [{ role: 'user', content: question }],
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

  // Las citations de Perplexity vienen en `raw.citations` (top-level del response
  // OpenRouter). Las exponemos al mismo nivel que antes.
  const citations = result.raw?.citations ?? result.citations ?? [];

  return {
    content: result.content ?? '',
    model: result.model_used,
    usage: result.usage,
    citations,
  };
}

// CLI: detecta si este archivo se está ejecutando directamente (cross-platform Windows/Unix)
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Falta OPENROUTER_API_KEY. Corre `npm run setup` o usa `/setup-openrouter` en Claude Code.');
    process.exit(1);
  }
  const [, , modelKey = 'pro', ...rest] = process.argv;
  const question = rest.join(' ');
  if (!question) {
    console.error('Uso: node src/research.js <quick|pro|search|reason|deep> "<pregunta>"');
    process.exit(1);
  }
  research(modelKey, question)
    .then(({ content, model, citations }) => {
      console.log(`\n=== ${model} ===\n`);
      console.log(content);
      if (citations?.length) {
        console.log('\n--- Fuentes ---');
        citations.forEach((c, i) => console.log(`[${i + 1}] ${c}`));
      }
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
