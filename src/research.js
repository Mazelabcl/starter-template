import 'dotenv/config';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error('Falta OPENROUTER_API_KEY. Corre `npm run setup` o usa `/setup-openrouter` en Claude Code.');
  process.exit(1);
}

const MODELS = {
  quick:  'perplexity/sonar',
  pro:    'perplexity/sonar-pro',
  search: 'perplexity/sonar-pro-search',
  reason: 'perplexity/sonar-reasoning-pro',
  deep:   'perplexity/sonar-deep-research',
};

export async function research(modelKey, question, opts = {}) {
  const model = MODELS[modelKey] ?? MODELS.pro;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: question }],
      ...opts,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model,
    usage: data.usage,
    citations: data.citations ?? [],
  };
}

// CLI: detecta si este archivo se está ejecutando directamente (cross-platform Windows/Unix)
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
