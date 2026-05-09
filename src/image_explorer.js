// src/image_explorer.js
// Explora un mismo prompt en N modelos de imagen distintos en paralelo y
// arma una grilla comparativa para que el usuario elija "la mano" que mejor
// le sirve. Ruta principal a Replicate (1 sola key da acceso a FLUX, Imagen 3,
// Ideogram, Recraft, SD 3.5). Mantiene gpt-image-2 vía script Python existente
// para reusar el identity lock y el batch async ya construido.
//
// Cero dependencias nuevas: fetch nativo, child_process para invocar Python.
//
// Filosofía:
//   - Si un modelo falla, los otros siguen (Promise.allSettled-style con límite).
//   - Costos calculados ANTES de empezar; advertencia si > $0.50.
//   - Output: PNG/JPG locales + index.json + grid.html standalone (CSS embebido).
//   - El dashboard puede leer el index.json directo sin parseo custom.

import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { runModel, download, ReplicateError } from './replicate_client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// =============================================================================
// Catálogo MODELS_IMG
// =============================================================================
// Cada modelo declara:
//   - id: clave canónica usada por el usuario.
//   - provider: 'openai' | 'replicate'.
//   - replicate_model: solo si provider==='replicate'. Slug "owner/name".
//   - cost_estimate_usd: costo aproximado por imagen 1024x1024 medium.
//   - capabilities: lista de tags (identity_lock, text_in_image, vector, etc.).
//   - description: 1 línea para el usuario.
//   - input_builder(opts): función pura que arma el `input` para Replicate
//       a partir de las opciones genéricas (prompt, aspect_ratio, seed, ...).
//   - output_format: 'png' | 'jpg' | 'webp' (para nombrar archivos).

export const MODELS_IMG = {
  'gpt-image-2': {
    id: 'gpt-image-2',
    provider: 'openai',
    replicate_model: null,
    cost_estimate_usd: 0.04,
    capabilities: ['identity_lock', 'references', 'edit', 'high_control'],
    strengths: 'Identity lock fuerte, edición con references, control alto.',
    weaknesses: 'Más caro que flux-schnell. Estilo a veces "promediado".',
    output_format: 'png',
  },
  'flux-1.1-pro': {
    id: 'flux-1.1-pro',
    provider: 'replicate',
    replicate_model: 'black-forest-labs/flux-1.1-pro',
    cost_estimate_usd: 0.04,
    capabilities: ['photorealism', 'anatomy_clean', 'detail'],
    strengths: 'Fotorrealismo brutal, anatomía limpia, manos correctas.',
    weaknesses: 'Estilo se siente "comercial"; menos creatividad libre.',
    output_format: 'png',
    input_builder: ({ prompt, aspect_ratio = '1:1', seed, output_format = 'png' }) => ({
      prompt,
      aspect_ratio,
      output_format,
      output_quality: 90,
      ...(seed != null ? { seed } : {}),
    }),
  },
  'flux-schnell': {
    id: 'flux-schnell',
    provider: 'replicate',
    replicate_model: 'black-forest-labs/flux-schnell',
    cost_estimate_usd: 0.003,
    capabilities: ['draft', 'fast', 'cheap'],
    strengths: 'Barato y rápido. Ideal para draft / shotlist masivo.',
    weaknesses: 'Calidad inferior a 1.1-pro. Anatomía menos confiable.',
    output_format: 'png',
    input_builder: ({ prompt, aspect_ratio = '1:1', seed, output_format = 'png' }) => ({
      prompt,
      aspect_ratio,
      output_format,
      ...(seed != null ? { seed } : {}),
    }),
  },
  'imagen-3': {
    id: 'imagen-3',
    provider: 'replicate',
    replicate_model: 'google/imagen-3',
    cost_estimate_usd: 0.05,
    capabilities: ['photography', 'composition', 'natural_light'],
    strengths: 'Composición rica, fotografía natural, luz cinematográfica.',
    weaknesses: 'Menos control sobre estilo no-fotográfico.',
    output_format: 'jpg',
    input_builder: ({ prompt, aspect_ratio = '1:1', safety_filter_level = 'block_only_high' }) => ({
      prompt,
      aspect_ratio,
      safety_filter_level,
    }),
  },
  'ideogram-v2': {
    id: 'ideogram-v2',
    provider: 'replicate',
    replicate_model: 'ideogram-ai/ideogram-v2',
    cost_estimate_usd: 0.05,
    capabilities: ['text_in_image', 'typography', 'logos', 'posters'],
    strengths: 'Excelente con texto en imagen (carteles, logos, tipografía).',
    weaknesses: 'Estilo a veces "stock"; menos fuerte en concept art puro.',
    output_format: 'png',
    input_builder: ({ prompt, aspect_ratio = '1:1', style_type = 'AUTO', seed }) => ({
      prompt,
      aspect_ratio,
      style_type,
      ...(seed != null ? { seed } : {}),
    }),
  },
  'recraft-v3': {
    id: 'recraft-v3',
    provider: 'replicate',
    replicate_model: 'recraft-ai/recraft-v3',
    cost_estimate_usd: 0.04,
    capabilities: ['branding', 'vector', 'illustration', 'design'],
    strengths: 'Branding, ilustración vectorial, design system. Muy controlable.',
    weaknesses: 'Menos fotorrealismo. No es para foto natural.',
    output_format: 'png',
    input_builder: ({ prompt, aspect_ratio = '1:1', style = 'realistic_image' }) => {
      // Recraft usa "size" en lugar de aspect_ratio puro.
      const sizeMap = {
        '1:1': '1024x1024',
        '16:9': '1820x1024',
        '9:16': '1024x1820',
        '4:3': '1365x1024',
        '3:4': '1024x1365',
      };
      return {
        prompt,
        size: sizeMap[aspect_ratio] || '1024x1024',
        style,
      };
    },
  },
  'sd-3.5-large': {
    id: 'sd-3.5-large',
    provider: 'replicate',
    replicate_model: 'stability-ai/stable-diffusion-3.5-large',
    cost_estimate_usd: 0.03,
    capabilities: ['general', 'flexible', 'open_source'],
    strengths: 'Flexible, balance precio/calidad, base sólida.',
    weaknesses: 'Sin "mano" distintiva; menos consistente que FLUX.',
    output_format: 'png',
    input_builder: ({ prompt, aspect_ratio = '1:1', output_format = 'png', seed }) => ({
      prompt,
      aspect_ratio,
      output_format,
      ...(seed != null ? { seed } : {}),
    }),
  },
};

// =============================================================================
// Validación de keys
// =============================================================================

export function validateKeys(modelIds) {
  const need = { openai: false, replicate: false };
  for (const id of modelIds) {
    const m = MODELS_IMG[id];
    if (!m) {
      throw new Error(`Modelo desconocido: "${id}". Disponibles: ${Object.keys(MODELS_IMG).join(', ')}.`);
    }
    if (m.provider === 'openai') need.openai = true;
    if (m.provider === 'replicate') need.replicate = true;
  }
  const missing = [];
  if (need.openai && !process.env.OPENAI_API_KEY) {
    missing.push('OPENAI_API_KEY (para gpt-image-2). Corre `npm run setup`.');
  }
  if (need.replicate && !process.env.REPLICATE_API_TOKEN) {
    missing.push('REPLICATE_API_TOKEN (para FLUX, Imagen 3, Ideogram, Recraft, SD). Corre `npm run setup` o consigue token en https://replicate.com/account/api-tokens.');
  }
  if (missing.length) {
    const err = new Error(`Faltan API keys:\n  - ${missing.join('\n  - ')}`);
    err.code = 'missing_keys';
    err.missing = missing;
    throw err;
  }
  return true;
}

// =============================================================================
// estimateExplorationCost()
// =============================================================================

export function estimateExplorationCost({ models, count = 1 }) {
  let total = 0;
  const breakdown = [];
  for (const id of models) {
    const m = MODELS_IMG[id];
    if (!m) continue;
    const sub = m.cost_estimate_usd * count;
    total += sub;
    breakdown.push({ model: id, count, unit_cost: m.cost_estimate_usd, subtotal: sub });
  }
  return { total_usd: Math.round(total * 1e4) / 1e4, breakdown };
}

// =============================================================================
// generateOne() — un solo modelo, una sola imagen
// =============================================================================

async function generateOpenAI({ prompt, output_path, options = {} }) {
  // Reusa el script Python existente. Quality medium por defecto, size 1024x1024.
  const size = options.size || aspectToSize(options.aspect_ratio || '1:1', '1024');
  const quality = options.quality || 'medium';
  const scriptPath = join(REPO_ROOT, 'scripts', 'openai_images.py');
  const venvPy = process.platform === 'win32'
    ? join(REPO_ROOT, '.venv', 'Scripts', 'python.exe')
    : join(REPO_ROOT, '.venv', 'bin', 'python');
  const py = existsSync(venvPy) ? venvPy : (process.platform === 'win32' ? 'python' : 'python3');

  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(py, [scriptPath, 'generate', prompt, output_path, '--size', size, '--quality', quality], {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => rejectFn(new Error(`No pude lanzar Python: ${e.message}`)));
    child.on('close', code => {
      if (code !== 0) {
        rejectFn(new Error(`gpt-image-2 falló (exit ${code}). stderr: ${stderr.slice(0, 400)}`));
        return;
      }
      if (!existsSync(output_path)) {
        rejectFn(new Error(`gpt-image-2 reportó OK pero no encuentro ${output_path}. stdout: ${stdout.slice(0, 200)}`));
        return;
      }
      resolveFn({ path: output_path, raw: { stdout: stdout.trim() } });
    });
  });
}

async function generateReplicate({ model, prompt, output_path, options = {} }) {
  const builder = model.input_builder;
  if (typeof builder !== 'function') {
    throw new Error(`Modelo ${model.id} no tiene input_builder definido.`);
  }
  const input = builder({
    prompt,
    aspect_ratio: options.aspect_ratio,
    seed: options.seed,
    style: options.style,
    output_format: options.output_format || model.output_format || 'png',
  });
  const result = await runModel({
    model_id: model.replicate_model,
    input,
    wait_timeout: options.timeout_s || 300,
  });
  if (!result.output_urls.length) {
    throw new Error(`Modelo ${model.id} no retornó URLs de output.`);
  }
  // Tomamos la primera URL — para count > 1 generamos N llamadas separadas (más simple, más justo).
  const dl = await download(result.output_urls[0], output_path);
  return {
    path: dl.path,
    bytes: dl.bytes,
    raw: { metrics: result.metrics, predict_time_seconds: result.metrics?.predict_time },
  };
}

// Mapea aspect ratio a size cuadrado/rectangular para gpt-image-2.
function aspectToSize(ratio, base = '1024') {
  const map = {
    '1:1': '1024x1024',
    '16:9': '1536x1024',
    '9:16': '1024x1536',
    '4:3': '1536x1024',
    '3:4': '1024x1536',
  };
  return map[ratio] || '1024x1024';
}

// =============================================================================
// explore()
// =============================================================================

export async function explore({
  prompt,
  models = ['gpt-image-2', 'flux-1.1-pro', 'imagen-3', 'ideogram-v2'],
  count = 1,
  output_dir,
  options = {},
  onProgress,
  parallelism = 4,
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('explore() requiere prompt string.');
  }
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('explore() requiere array `models` no vacío.');
  }
  if (!output_dir) {
    output_dir = join(REPO_ROOT, 'content', 'explorations', timestampSlug());
  }
  output_dir = resolve(output_dir);

  // Filtra modelos disponibles según keys presentes — NO falla si falta una key,
  // skipea ese modelo con razón clara. Solo falla si NINGÚN modelo es runnable.
  const available = [];
  const skipped = [];
  for (const id of models) {
    const m = MODELS_IMG[id];
    if (!m) {
      skipped.push({ model: id, reason: `desconocido (no está en MODELS_IMG)` });
      continue;
    }
    if (m.provider === 'openai' && !process.env.OPENAI_API_KEY) {
      skipped.push({ model: id, reason: 'falta OPENAI_API_KEY' });
      continue;
    }
    if (m.provider === 'replicate' && !process.env.REPLICATE_API_TOKEN) {
      skipped.push({ model: id, reason: 'falta REPLICATE_API_TOKEN' });
      continue;
    }
    available.push(m);
  }
  if (!available.length) {
    const err = new Error(
      `Ningún modelo runnable. Skipped:\n  - ${skipped.map(s => `${s.model}: ${s.reason}`).join('\n  - ')}`,
    );
    err.code = 'no_models_available';
    err.skipped = skipped;
    throw err;
  }

  // Costo estimado + advertencia si > $0.50
  const cost = estimateExplorationCost({ models: available.map(m => m.id), count });
  if (cost.total_usd > 0.5) {
    emit(onProgress, { type: 'cost_warning', total_usd: cost.total_usd, breakdown: cost.breakdown });
  }
  emit(onProgress, { type: 'plan', models: available.map(m => m.id), skipped, cost, output_dir });

  await mkdir(output_dir, { recursive: true });

  // Construye lista plana de jobs (modelo × count)
  const jobs = [];
  for (const m of available) {
    for (let i = 0; i < count; i++) {
      const ext = m.output_format || 'png';
      const idx_suffix = count > 1 ? `_${i + 1}` : '';
      const filename = `${m.id}${idx_suffix}.${ext}`;
      jobs.push({
        model: m,
        index_in_model: i,
        output_path: join(output_dir, filename),
        filename,
      });
    }
  }

  // Ejecuta en paralelo con límite (chatBatch-style)
  const results = new Array(jobs.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const job = jobs[i];
      const startedAt = Date.now();
      emit(onProgress, { type: 'start', model: job.model.id, filename: job.filename });
      try {
        let outcome;
        if (job.model.provider === 'openai') {
          outcome = await generateOpenAI({ prompt, output_path: job.output_path, options });
        } else if (job.model.provider === 'replicate') {
          outcome = await generateReplicate({ model: job.model, prompt, output_path: job.output_path, options });
        } else {
          throw new Error(`Provider desconocido: ${job.model.provider}`);
        }
        const elapsed_ms = Date.now() - startedAt;
        results[i] = {
          ok: true,
          model: job.model.id,
          provider: job.model.provider,
          path: outcome.path,
          filename: job.filename,
          bytes: outcome.bytes ?? null,
          cost_usd: job.model.cost_estimate_usd,
          elapsed_ms,
          raw: outcome.raw || null,
        };
        emit(onProgress, { type: 'done', model: job.model.id, filename: job.filename, elapsed_ms, ok: true });
      } catch (e) {
        const elapsed_ms = Date.now() - startedAt;
        results[i] = {
          ok: false,
          model: job.model.id,
          provider: job.model.provider,
          filename: job.filename,
          error: e.message,
          error_code: e.code || (e instanceof ReplicateError ? e.code : 'unknown'),
          elapsed_ms,
        };
        emit(onProgress, { type: 'done', model: job.model.id, filename: job.filename, elapsed_ms, ok: false, error: e.message });
      }
    }
  }
  const workers = Array.from({ length: Math.min(parallelism, jobs.length) }, () => worker());
  await Promise.all(workers);

  // index.json estructurado
  const successes = results.filter(r => r.ok);
  const failures = results.filter(r => !r.ok);
  const totalCost = successes.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const totalTime = results.reduce((s, r) => Math.max(s, r.elapsed_ms || 0), 0);

  const index = {
    version: 1,
    created_at: new Date().toISOString(),
    prompt,
    options,
    output_dir,
    models_requested: models,
    models_run: available.map(m => m.id),
    models_skipped: skipped,
    count_per_model: count,
    parallelism,
    results,
    summary: {
      total_jobs: results.length,
      successes: successes.length,
      failures: failures.length,
      total_cost_usd_estimated: Math.round(totalCost * 1e4) / 1e4,
      wall_time_ms_max: totalTime,
    },
  };
  await writeFile(join(output_dir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

  // grid.html standalone
  await compareGrid(output_dir);

  emit(onProgress, { type: 'finished', output_dir, summary: index.summary });
  return index;
}

function emit(cb, ev) {
  if (typeof cb === 'function') {
    try { cb(ev); } catch { /* el caller no rompe la generación */ }
  }
}

function timestampSlug() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// =============================================================================
// compareGrid(output_dir) — genera grid.html standalone
// =============================================================================

export async function compareGrid(output_dir) {
  const indexPath = join(output_dir, 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`No hay index.json en ${output_dir}. Corre explore() primero.`);
  }
  const idx = JSON.parse(await readFile(indexPath, 'utf8'));
  const html = renderGridHtml(idx);
  const outPath = join(output_dir, 'grid.html');
  await writeFile(outPath, html, 'utf8');
  return outPath;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderGridHtml(idx) {
  const cells = idx.results.map(r => {
    if (r.ok) {
      // Path relativo al directorio del HTML (ambos están en output_dir).
      const src = encodeURIComponent(r.filename);
      return `
    <div class="cell ok">
      <div class="thumb"><img src="${src}" alt="${escapeHtml(r.model)}" loading="lazy"></div>
      <div class="meta">
        <h3>${escapeHtml(r.model)}</h3>
        <p class="prov">${escapeHtml(r.provider)}</p>
        <p>Costo: ~$${(r.cost_usd ?? 0).toFixed(4)}</p>
        <p>Tiempo: ${(r.elapsed_ms / 1000).toFixed(1)}s</p>
        <p class="bytes">${r.bytes ? (r.bytes / 1024).toFixed(0) + ' KB' : '—'}</p>
        <button class="winner-btn" data-model="${escapeHtml(r.model)}" data-filename="${escapeHtml(r.filename)}">Usar esta</button>
      </div>
    </div>`;
    }
    return `
    <div class="cell fail">
      <div class="thumb error">
        <span>FALLO</span>
      </div>
      <div class="meta">
        <h3>${escapeHtml(r.model)}</h3>
        <p class="prov">${escapeHtml(r.provider)}</p>
        <p class="err">${escapeHtml(r.error || 'error desconocido')}</p>
      </div>
    </div>`;
  }).join('\n');

  const promptEsc = escapeHtml(idx.prompt);
  const summary = idx.summary || {};
  const skippedHtml = (idx.models_skipped || []).length
    ? `<p class="skipped"><strong>Skipped:</strong> ${idx.models_skipped.map(s => `${escapeHtml(s.model)} (${escapeHtml(s.reason)})`).join(', ')}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>image-explorer · ${escapeHtml(idx.created_at)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #0e0e10; color: #e8e8ea; }
  header { margin-bottom: 24px; }
  h1 { margin: 0 0 8px 0; font-size: 18px; font-weight: 600; }
  .prompt { background: #1a1a1d; padding: 12px 16px; border-radius: 6px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; max-height: 160px; overflow: auto; }
  .stats { font-size: 12px; color: #9a9aa0; margin-top: 8px; }
  .skipped { font-size: 12px; color: #b8a070; margin-top: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .cell { background: #1a1a1d; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a30; transition: border-color .15s; }
  .cell:hover { border-color: #4a4a55; }
  .cell.fail { opacity: 0.7; }
  .cell.winner { border-color: #6ec96e; box-shadow: 0 0 0 2px rgba(110,201,110,0.2); }
  .thumb { aspect-ratio: 1 / 1; background: #0a0a0c; display: flex; align-items: center; justify-content: center; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .thumb.error { color: #c45050; font-size: 14px; font-weight: 600; }
  .meta { padding: 12px 14px; }
  .meta h3 { margin: 0 0 4px 0; font-size: 14px; font-weight: 600; }
  .meta .prov { margin: 0 0 8px 0; font-size: 11px; color: #7a7a82; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta p { margin: 2px 0; font-size: 12px; color: #b0b0b8; }
  .meta .err { color: #c45050; word-break: break-word; }
  .meta .bytes { color: #6a6a72; }
  .winner-btn { margin-top: 8px; padding: 6px 12px; background: #2a2a30; color: #e8e8ea; border: 1px solid #3a3a45; border-radius: 4px; font-size: 12px; cursor: pointer; transition: background .15s; }
  .winner-btn:hover { background: #3a3a45; }
  .winner-btn.picked { background: #6ec96e; color: #0e0e10; border-color: #6ec96e; }
  footer { margin-top: 32px; font-size: 11px; color: #6a6a72; }
  code { background: #1a1a1d; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>image-explorer · ${escapeHtml(idx.models_run.join(' · '))}</h1>
  <div class="prompt">${promptEsc}</div>
  <div class="stats">
    Generado: ${escapeHtml(idx.created_at)} ·
    ${summary.successes ?? 0}/${summary.total_jobs ?? 0} OK ·
    Costo total estimado: $${(summary.total_cost_usd_estimated ?? 0).toFixed(4)} ·
    Wall time: ${((summary.wall_time_ms_max ?? 0) / 1000).toFixed(1)}s
  </div>
  ${skippedHtml}
</header>
<main class="grid">
${cells}
</main>
<footer>
  <p>Para marcar un ganador desde CLI: <code>node src/image_explorer.js pick &lt;output_dir&gt; &lt;model_id&gt;</code></p>
  <p>Si haces click en "Usar esta" se marca visualmente, pero la copia a winner.png se hace desde CLI con el comando de arriba.</p>
</footer>
<script>
(function(){
  document.querySelectorAll('.winner-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cell').forEach(c => c.classList.remove('winner'));
      document.querySelectorAll('.winner-btn').forEach(b => { b.classList.remove('picked'); b.textContent = 'Usar esta'; });
      const cell = btn.closest('.cell');
      cell.classList.add('winner');
      btn.classList.add('picked');
      btn.textContent = 'Marcado · corre CLI: pick';
      console.log('Para confirmar, corre: node src/image_explorer.js pick <output_dir> ' + btn.dataset.model);
    });
  });
})();
</script>
</body>
</html>`;
}

// =============================================================================
// pickWinner(output_dir, model_name)
// =============================================================================

export async function pickWinner(output_dir, model_name) {
  const indexPath = join(output_dir, 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`No hay index.json en ${output_dir}.`);
  }
  const idx = JSON.parse(await readFile(indexPath, 'utf8'));
  // Busca el primer success con ese modelo (si count>1, gana el primero — el usuario puede pasar filename custom).
  const winner = idx.results.find(r => r.ok && r.model === model_name);
  if (!winner) {
    const oks = idx.results.filter(r => r.ok).map(r => r.model);
    throw new Error(`No hay output OK para modelo "${model_name}". Disponibles: ${oks.join(', ') || '(ninguno)'}.`);
  }
  // Decide extension del winner según el archivo original
  const srcPath = join(output_dir, winner.filename);
  const ext = winner.filename.split('.').pop() || 'png';
  const dstPng = join(output_dir, 'winner.png');
  const dstNative = join(output_dir, `winner.${ext}`);
  // Copia al nombre nativo siempre, y si es png también queda en winner.png. Si no
  // es png, copiamos también con extensión nativa para no romper el formato.
  await copyFile(srcPath, dstNative);
  if (ext !== 'png') {
    // Para mantener la convención `winner.png` (que el flujo posterior asume),
    // dejamos también una copia con ese nombre — aunque internamente sea jpg.
    // El consumidor puede inspeccionar `winner.json` para el formato real.
    await copyFile(srcPath, dstPng);
  } else {
    await copyFile(srcPath, dstPng);
  }
  const meta = {
    picked_at: new Date().toISOString(),
    model: winner.model,
    provider: winner.provider,
    source_filename: winner.filename,
    winner_filename: `winner.${ext}`,
    winner_filename_canonical: 'winner.png',
    cost_usd: winner.cost_usd,
    elapsed_ms: winner.elapsed_ms,
    prompt: idx.prompt,
    options: idx.options,
  };
  await writeFile(join(output_dir, 'winner.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

// =============================================================================
// CLI
// =============================================================================
// Modos:
//   node src/image_explorer.js --prompt "..." --models "a,b,c" --output dir
//   node src/image_explorer.js pick <output_dir> <model_id>
//   node src/image_explorer.js list      # lista catálogo

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function cliMain() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  // Subcomandos
  if (argv[0] === 'list') {
    for (const [id, m] of Object.entries(MODELS_IMG)) {
      console.log(`${id.padEnd(16)} ${m.provider.padEnd(10)} $${m.cost_estimate_usd.toFixed(4)}/img  — ${m.strengths}`);
    }
    process.exit(0);
  }
  if (argv[0] === 'pick') {
    const dir = argv[1];
    const model = argv[2];
    if (!dir || !model) {
      console.error('Uso: node src/image_explorer.js pick <output_dir> <model_id>');
      process.exit(2);
    }
    try {
      const meta = await pickWinner(dir, model);
      console.log(`OK · winner=${meta.model} · ${meta.winner_filename}`);
      console.log(`     ${meta.source_filename} → winner.png`);
      process.exit(0);
    } catch (e) {
      console.error(`FAIL: ${e.message}`);
      process.exit(1);
    }
  }

  // Modo principal: --prompt
  const args = parseArgs(argv);
  const prompt = args.prompt;
  const modelsStr = args.models || 'gpt-image-2,flux-1.1-pro,imagen-3,ideogram-v2';
  const output = args.output || join(REPO_ROOT, 'content', 'explorations', timestampSlug());
  const count = args.count ? parseInt(args.count, 10) : 1;
  const aspect_ratio = args.aspect || args.aspect_ratio || '1:1';
  const seed = args.seed ? parseInt(args.seed, 10) : undefined;

  if (!prompt || typeof prompt !== 'string') {
    console.error('Falta --prompt "..."\n');
    printHelp();
    process.exit(2);
  }

  loadEnv(); // best-effort: carga .env si existe

  const models = modelsStr.split(',').map(s => s.trim()).filter(Boolean);

  console.log(`--- image-explorer ---`);
  console.log(`Prompt:  ${prompt}`);
  console.log(`Models:  ${models.join(', ')}`);
  console.log(`Output:  ${output}`);
  console.log(`Count:   ${count} por modelo`);
  console.log(`Aspect:  ${aspect_ratio}\n`);

  try {
    const idx = await explore({
      prompt,
      models,
      count,
      output_dir: output,
      options: { aspect_ratio, seed },
      onProgress: (ev) => {
        if (ev.type === 'plan') {
          console.log(`Plan: ${ev.models.length} modelos, ${ev.skipped.length} skipped, costo estimado $${ev.cost.total_usd.toFixed(4)}.`);
          if (ev.skipped.length) {
            for (const s of ev.skipped) console.log(`  skip ${s.model}: ${s.reason}`);
          }
        } else if (ev.type === 'cost_warning') {
          console.log(`! Advertencia: costo estimado $${ev.total_usd.toFixed(4)} > $0.50.`);
        } else if (ev.type === 'start') {
          console.log(`-> ${ev.model}  (${ev.filename})`);
        } else if (ev.type === 'done') {
          const tag = ev.ok ? 'OK' : 'FAIL';
          console.log(`<- ${ev.model}  ${tag}  ${(ev.elapsed_ms / 1000).toFixed(1)}s${ev.error ? `  err=${ev.error.slice(0, 80)}` : ''}`);
        }
      },
    });
    console.log('');
    console.log(`Generadas: ${idx.summary.successes}/${idx.summary.total_jobs}`);
    console.log(`Costo:     $${idx.summary.total_cost_usd_estimated.toFixed(4)}`);
    console.log(`Tiempo:    ${(idx.summary.wall_time_ms_max / 1000).toFixed(1)}s (wall, paralelo)`);
    console.log(`Output:    ${idx.output_dir}`);
    console.log(`Grid:      ${join(idx.output_dir, 'grid.html')}`);
    console.log(`Index:     ${join(idx.output_dir, 'index.json')}`);
    console.log('');
    console.log(`Para elegir ganador: node src/image_explorer.js pick "${idx.output_dir}" <model_id>`);
    process.exit(idx.summary.failures > 0 && idx.summary.successes === 0 ? 1 : 0);
  } catch (e) {
    console.error(`FAIL: ${e.message}`);
    if (e.code === 'missing_keys') {
      console.error('\nConfigura las API keys con: npm run setup');
    }
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
image-explorer — explora un prompt en N modelos de imagen en paralelo.

Uso:
  node src/image_explorer.js --prompt "..." [opciones]
  node src/image_explorer.js list
  node src/image_explorer.js pick <output_dir> <model_id>

Opciones:
  --prompt "..."       Prompt a explorar. Obligatorio.
  --models "a,b,c"     Lista CSV. Default: gpt-image-2,flux-1.1-pro,imagen-3,ideogram-v2
  --output <dir>       Directorio de salida. Default: content/explorations/<timestamp>
  --count <N>          Imágenes por modelo. Default 1.
  --aspect <ratio>     1:1, 16:9, 9:16, 4:3, 3:4. Default 1:1.
  --seed <N>           Seed (cuando el modelo lo soporte) para reproducibilidad.

Modelos disponibles: gpt-image-2, flux-1.1-pro, flux-schnell, imagen-3,
                     ideogram-v2, recraft-v3, sd-3.5-large

API keys:
  OPENAI_API_KEY      Para gpt-image-2.
  REPLICATE_API_TOKEN Para todos los demás (1 sola key).

Tips:
  - Si solo quieres draft barato: --models "flux-schnell" (~$0.003/img).
  - Si necesitas texto en imagen: incluye ideogram-v2.
  - Si necesitas branding/vector: incluye recraft-v3.
  - Para identity lock con references: usa la skill image-gen, no este explorer.
`);
}

// Carga .env best-effort sin depender de dotenv (mirror de openrouter-client.test.js)
function loadEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return false;
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) process.env[key] = val;
    }
    return true;
  } catch {
    return false;
  }
}

// Detecta si está corriendo como CLI (entry-point) vs. importado.
const isMain = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch { return false; }
})();

if (isMain) {
  cliMain().catch(e => {
    console.error(`fatal: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  });
}

export default {
  MODELS_IMG,
  explore,
  compareGrid,
  pickWinner,
  validateKeys,
  estimateExplorationCost,
};
