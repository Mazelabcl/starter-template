// src/replicate_client.js
// Cliente minimal de Replicate API. Cero deps, fetch nativo Node 18+.
//
// Replicate funciona como router único para FLUX, Imagen 3, Ideogram, Recraft,
// SD 3.5 y otros modelos open-source. Una sola key (REPLICATE_API_TOKEN) da
// acceso a todos. Este cliente:
//   - Lanza una predicción (POST /predictions con `{model: "owner/name", input}`)
//   - Polling cada 2s hasta succeeded/failed/canceled (timeout configurable)
//   - Retorna { output_urls, metrics, raw }
//   - Descarga el PNG/JPG localmente (`download(url, dest_path)`)
//
// Errores estructurados con `ReplicateError` (status, code, provider_error).
//
// Diseño paralelo al cliente OpenRouter: misma forma de los errores, mismo
// estilo de mensajes en español neutro, mismo patrón de validación de key.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

// =============================================================================
// Config
// =============================================================================

const ENDPOINT_PREDICTIONS = 'https://api.replicate.com/v1/predictions';
const ENDPOINT_MODELS = 'https://api.replicate.com/v1/models';
const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_S = 300;

function getApiKey() {
  const key = process.env.REPLICATE_API_TOKEN;
  if (!key) {
    throw new ReplicateError(
      'Falta REPLICATE_API_TOKEN. Corre `npm run setup` y configura tu token de https://replicate.com/account/api-tokens.',
      { status: 0, code: 'no_api_key' },
    );
  }
  return key;
}

function buildHeaders(apiKey) {
  return {
    'Authorization': `Token ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// =============================================================================
// ReplicateError
// =============================================================================

export class ReplicateError extends Error {
  constructor(message, { status = 0, code = 'unknown', provider_error = null } = {}) {
    super(message);
    this.name = 'ReplicateError';
    this.status = status;
    this.code = code;
    this.provider_error = provider_error;
  }
}

// =============================================================================
// runModel()
// =============================================================================
// Lanza una predicción y polea hasta que termina.
//
// model_id: "owner/name" (ej. "black-forest-labs/flux-1.1-pro").
//   Si necesitas pinear una versión específica, pasa también `version: <hash>`.
// input: objeto con los inputs del modelo (depende de cada modelo).
// wait_timeout: segundos máximos de espera total. Default 300 (5 min).
// poll_ms: intervalo de polling. Default 2000ms.
// signal: AbortSignal opcional para cancelar.

export async function runModel({
  model_id,
  version,
  input,
  wait_timeout = DEFAULT_TIMEOUT_S,
  poll_ms = DEFAULT_POLL_MS,
  signal,
} = {}) {
  if (!model_id || typeof model_id !== 'string' || !model_id.includes('/')) {
    throw new ReplicateError(
      `model_id inválido: "${model_id}". Esperaba "owner/name" (ej. "black-forest-labs/flux-1.1-pro").`,
      { status: 0, code: 'invalid_model_id' },
    );
  }
  if (!input || typeof input !== 'object') {
    throw new ReplicateError('input requerido (objeto con los inputs del modelo).', { code: 'invalid_input' });
  }

  const apiKey = getApiKey();
  const headers = buildHeaders(apiKey);

  // Body: si hay version, va `{version, input}` (model determinístico).
  // Si no, `{model: "owner/name", input}` (Replicate elige última version oficial).
  const body = version
    ? { version, input }
    : { model: model_id, input };

  // -------- POST /predictions
  let createRes;
  try {
    createRes = await fetch(ENDPOINT_PREDICTIONS, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new ReplicateError(`Request abortada: ${e.message}`, { code: 'aborted' });
    }
    if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(e.message)) {
      throw new ReplicateError(
        `No hay conexión a api.replicate.com. Detalle: ${e.message}`,
        { code: 'network_error' },
      );
    }
    throw new ReplicateError(`Fetch falló: ${e.message}`, { code: 'fetch_error' });
  }

  if (!createRes.ok) {
    const text = await safeReadText(createRes);
    let provErr = null;
    try { provErr = JSON.parse(text); } catch { /* texto plano */ }
    const code = httpStatusToCode(createRes.status);
    const message = formatHttpError(createRes.status, code, model_id, text);
    throw new ReplicateError(message, {
      status: createRes.status,
      code,
      provider_error: provErr,
    });
  }

  let prediction;
  try {
    prediction = await createRes.json();
  } catch (e) {
    throw new ReplicateError(`Respuesta no es JSON válido: ${e.message}`, { code: 'invalid_response' });
  }

  const predictionId = prediction.id;
  const getUrl = prediction.urls?.get || `${ENDPOINT_PREDICTIONS}/${predictionId}`;

  // -------- Polling hasta succeeded/failed/canceled
  const startedAt = Date.now();
  const timeoutMs = wait_timeout * 1000;
  let current = prediction;

  while (current.status !== 'succeeded' && current.status !== 'failed' && current.status !== 'canceled') {
    if (Date.now() - startedAt > timeoutMs) {
      throw new ReplicateError(
        `Timeout esperando ${model_id} después de ${wait_timeout}s (status=${current.status}). ID=${predictionId}`,
        { code: 'timeout' },
      );
    }
    if (signal?.aborted) {
      throw new ReplicateError(`Polling abortado.`, { code: 'aborted' });
    }
    await sleep(poll_ms);

    let pollRes;
    try {
      pollRes = await fetch(getUrl, { headers, signal });
    } catch (e) {
      // Errores transitorios de red durante polling: reintentamos en la siguiente iteración.
      if (e.name === 'AbortError') throw new ReplicateError('Polling abortado.', { code: 'aborted' });
      continue;
    }
    if (!pollRes.ok) {
      // 5xx en poll → reintenta. 4xx → falla.
      if (pollRes.status >= 500) continue;
      const text = await safeReadText(pollRes);
      throw new ReplicateError(
        `Replicate poll ${pollRes.status} para ${predictionId}. Detalle: ${text.slice(0, 200)}`,
        { status: pollRes.status, code: httpStatusToCode(pollRes.status) },
      );
    }
    try {
      current = await pollRes.json();
    } catch {
      continue; // body raro, reintentamos.
    }
  }

  if (current.status === 'failed') {
    throw new ReplicateError(
      `Modelo ${model_id} falló: ${current.error || 'sin detalle'}`,
      { code: 'prediction_failed', provider_error: current },
    );
  }
  if (current.status === 'canceled') {
    throw new ReplicateError(`Modelo ${model_id} canceló la predicción.`, { code: 'prediction_canceled' });
  }

  // -------- output puede ser string (1 url), array de strings (varias) o objeto.
  const output_urls = normalizeOutput(current.output);
  return {
    output_urls,
    metrics: current.metrics || {},
    raw: current,
  };
}

function normalizeOutput(out) {
  if (out == null) return [];
  if (typeof out === 'string') return [out];
  if (Array.isArray(out)) {
    return out.flatMap(o => {
      if (typeof o === 'string') return [o];
      if (o && typeof o === 'object' && typeof o.url === 'string') return [o.url];
      return [];
    });
  }
  if (typeof out === 'object' && typeof out.url === 'string') return [out.url];
  return [];
}

// =============================================================================
// download()
// =============================================================================
// Descarga binario remoto al disco local. Crea carpetas intermedias.

export async function download(url, dest_path, { signal, timeout_ms = 120_000 } = {}) {
  if (!url || typeof url !== 'string') {
    throw new ReplicateError('download() requiere url string.', { code: 'invalid_input' });
  }
  if (!dest_path || typeof dest_path !== 'string') {
    throw new ReplicateError('download() requiere dest_path string.', { code: 'invalid_input' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`download timeout ${timeout_ms}ms`)), timeout_ms);
  if (timer.unref) timer.unref();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new ReplicateError(`Descarga falló: ${e.message}`, { code: 'download_error' });
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new ReplicateError(
      `Descarga ${res.status} para ${url}.`,
      { status: res.status, code: httpStatusToCode(res.status) },
    );
  }

  let buf;
  try {
    const arr = await res.arrayBuffer();
    buf = Buffer.from(arr);
  } catch (e) {
    clearTimeout(timer);
    throw new ReplicateError(`No pude leer body de descarga: ${e.message}`, { code: 'download_error' });
  }
  clearTimeout(timer);

  await mkdir(dirname(dest_path), { recursive: true });
  await writeFile(dest_path, buf);
  return { path: dest_path, bytes: buf.length };
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeReadText(res) {
  try { return await res.text(); } catch { return ''; }
}

function httpStatusToCode(status) {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'payment_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'unprocessable_entity';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'server_error';
  if (status >= 400 && status < 500) return 'client_error';
  return 'http_error';
}

function formatHttpError(status, code, modelId, text) {
  const snippet = (text || '').slice(0, 300).trim();
  if (status === 401) return `Replicate 401 (token inválido o ausente). Revisa REPLICATE_API_TOKEN. Detalle: ${snippet}`;
  if (status === 402) return `Replicate 402 (sin créditos). Recarga en replicate.com/account/billing. Detalle: ${snippet}`;
  if (status === 404) return `Replicate 404: modelo "${modelId}" no encontrado. Detalle: ${snippet}`;
  if (status === 422) return `Replicate 422 (input inválido para ${modelId}). Detalle: ${snippet}`;
  if (status === 429) return `Replicate 429 (rate limit). Reintenta con backoff. Detalle: ${snippet}`;
  if (status >= 500) return `Replicate ${status} (error del proveedor). Reintenta. Detalle: ${snippet}`;
  return `Replicate ${status} (${code}) modelo=${modelId}. Detalle: ${snippet}`;
}

export default {
  runModel,
  download,
  ReplicateError,
};
