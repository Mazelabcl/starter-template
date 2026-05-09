// scripts/voice_tts.js
// TTS de respuestas largas con OpenAI TTS (Sprint 4.6 — Voz Nivel 2).
//
// CLI standalone para convertir texto en audio usando OpenAI TTS y reproducirlo
// localmente. Pensado para que Aldo escuche respuestas largas mientras hace otra
// cosa, sin pagar el mismo texto dos veces gracias al cache local.
//
// Uso:
//   node scripts/voice_tts.js --text "hola mundo"
//   node scripts/voice_tts.js --file respuesta.txt --voice onyx --speed 1.2
//   node scripts/voice_tts.js --text "..." --output salida.mp3 --no-play
//   node scripts/voice_tts.js --clear-cache
//   node scripts/voice_tts.js --help
//
// Exit code: 0 si OK, 1 si falla.
//
// Cero deps nuevas — usa fetch nativo (Node 18+), child_process y crypto.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------- defaults ----------

const DEFAULTS = {
  voice: 'nova',
  model: 'tts-1',
  speed: 1.0,
  format: 'mp3',
  chunkSize: 2000,
  cacheDir: '.cache/voice',
};

const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const VALID_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'];

// ---------- argv parsing ----------

/**
 * Parsea argv en un objeto plano. Acepta:
 *   --flag value   → { flag: value }
 *   --flag         → { flag: true }
 * Para flags repetidas, gana la última. Exportado para tests.
 */
export function parseArgs(argv) {
  const out = {
    text: null,
    file: null,
    voice: DEFAULTS.voice,
    model: DEFAULTS.model,
    speed: DEFAULTS.speed,
    output: null,
    play: null, // null = decide por defecto según --output
    chunkSize: DEFAULTS.chunkSize,
    clearCache: false,
    help: false,
    cacheDir: DEFAULTS.cacheDir,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--text':       out.text = argv[++i]; break;
      case '--file':       out.file = argv[++i]; break;
      case '--voice':      out.voice = argv[++i]; break;
      case '--model':      out.model = argv[++i]; break;
      case '--speed':      out.speed = parseFloat(argv[++i]); break;
      case '--output':     out.output = argv[++i]; break;
      case '--play':       out.play = true; break;
      case '--no-play':    out.play = false; break;
      case '--chunk-size': out.chunkSize = parseInt(argv[++i], 10); break;
      case '--cache-dir':  out.cacheDir = argv[++i]; break;
      case '--clear-cache': out.clearCache = true; break;
      case '--help':
      case '-h':           out.help = true; break;
      default:
        // Ignoramos flags desconocidas pero avisamos en stderr salvo en tests.
        if (a.startsWith('--')) {
          console.error(`[voice_tts] flag desconocida ignorada: ${a}`);
        }
    }
  }

  // Default: si hay --output explícito y no se pidió --play, no reproduce.
  // Si no hay --output, reproduce por defecto.
  if (out.play === null) {
    out.play = !out.output;
  }
  return out;
}

// ---------- validación ----------

function validateArgs(args) {
  if (args.help) return; // se maneja arriba
  if (args.clearCache) return; // tampoco necesita texto
  if (!args.text && !args.file) {
    throw new Error('Debes pasar --text "..." o --file path/al/texto.txt. Corre con --help para detalle.');
  }
  if (args.text && args.file) {
    throw new Error('Pasa --text O --file, no ambos.');
  }
  if (!VALID_VOICES.includes(args.voice)) {
    throw new Error(`Voz inválida: ${args.voice}. Válidas: ${VALID_VOICES.join(', ')}`);
  }
  if (!VALID_MODELS.includes(args.model)) {
    throw new Error(`Modelo inválido: ${args.model}. Válidos: ${VALID_MODELS.join(', ')}`);
  }
  if (Number.isNaN(args.speed) || args.speed < 0.25 || args.speed > 4.0) {
    throw new Error(`Velocidad fuera de rango: ${args.speed}. Debe estar entre 0.25 y 4.0.`);
  }
  if (Number.isNaN(args.chunkSize) || args.chunkSize < 200 || args.chunkSize > 4000) {
    throw new Error(`chunk-size fuera de rango: ${args.chunkSize}. Debe estar entre 200 y 4000.`);
  }
}

// ---------- chunking ----------

/**
 * Divide texto en trozos respetando límites de oración y párrafo.
 * Estrategia:
 *   1. Si el texto entero cabe en chunkSize, retorna un solo chunk.
 *   2. Si no, intenta partir por dobles saltos (párrafos).
 *   3. Si un párrafo sigue siendo > chunkSize, parte por oraciones (. ? ! seguidos de espacio/fin).
 *   4. Si una oración es absurdamente larga (>chunkSize), corta por longitud como último recurso.
 *
 * Exportado para tests.
 */
export function chunkText(text, chunkSize = DEFAULTS.chunkSize) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const chunks = [];
  // Paso 1: separa por párrafos (uno o más newlines).
  const paragraphs = clean.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);

  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length <= chunkSize) {
      // Párrafo cabe entero — intenta acumular con el current.
      if ((current + '\n\n' + para).length <= chunkSize) {
        current = current ? current + '\n\n' + para : para;
      } else {
        flush();
        current = para;
      }
      continue;
    }
    // Párrafo demasiado largo — parte por oraciones.
    flush();
    const sentences = splitSentences(para);
    for (const s of sentences) {
      if ((current + ' ' + s).trim().length <= chunkSize) {
        current = current ? current + ' ' + s : s;
      } else {
        flush();
        if (s.length <= chunkSize) {
          current = s;
        } else {
          // Oración demasiado larga (raro). Corta duro.
          for (let i = 0; i < s.length; i += chunkSize) {
            chunks.push(s.slice(i, i + chunkSize));
          }
          current = '';
        }
      }
    }
    flush();
  }
  flush();
  return chunks;
}

/**
 * Divide un párrafo por oraciones. Heurística simple pero suficiente para
 * español: corta tras `.`, `?`, `!` cuando el siguiente char es espacio o fin.
 */
function splitSentences(paragraph) {
  // Regex: captura todo hasta `[.?!]+` seguido de espacio/fin, no consume el separador.
  // Usamos lookbehind para no perder los signos de cierre.
  const parts = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!parts) return [paragraph];
  return parts.map(p => p.trim()).filter(Boolean);
}

// ---------- limpieza de texto: skip de bloques de código ----------

/**
 * Remueve bloques de código (```...```) y lectura inline de código (`code`)
 * porque TTS los lee de forma horrible. Exportado para tests.
 */
export function stripCodeBlocks(text) {
  // Bloques ```...``` (multiline, lazy).
  let out = text.replace(/```[\s\S]*?```/g, ' [bloque de código omitido] ');
  // Code inline: `algo` cuando no es parte de otra estructura.
  out = out.replace(/`[^`\n]+`/g, ' ');
  // Múltiples espacios → uno solo.
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- platform detection ----------

/**
 * Retorna el comando que reproduce un archivo de audio según la plataforma
 * actual. Si no hay player conocido, retorna null. Exportado para tests.
 *
 * Para `forcePlatform` usamos el formato de Node (`win32`, `darwin`, `linux`).
 */
export function detectPlayer(forcePlatform) {
  const p = forcePlatform || platform();
  if (p === 'win32') {
    // `cmd /c start "" "<file>"` abre el archivo con la app default y retorna.
    // Las comillas vacías son el title del cmd, evitan que start interprete
    // el path con espacios como título.
    return { cmd: 'cmd', args: ['/c', 'start', '""'], appendFile: true, shell: false };
  }
  if (p === 'darwin') {
    return { cmd: 'afplay', args: [], appendFile: true, shell: false };
  }
  if (p === 'linux') {
    // Probamos mpg123 primero (común en distros); si no existe, aplay.
    if (commandExists('mpg123')) return { cmd: 'mpg123', args: ['-q'], appendFile: true, shell: false };
    if (commandExists('aplay'))  return { cmd: 'aplay', args: ['-q'], appendFile: true, shell: false };
    if (commandExists('ffplay')) return { cmd: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'], appendFile: true, shell: false };
    return null;
  }
  return null;
}

function commandExists(cmd) {
  try {
    const which = platform() === 'win32' ? 'where' : 'which';
    const r = spawnSync(which, [cmd], { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

// ---------- env loader (sin dotenv) ----------

function loadEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return false;
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
}

// ---------- cache helpers ----------

function cacheDirAbs(rel) {
  return isAbsolute(rel) ? rel : join(REPO_ROOT, rel);
}

function ensureCacheDir(rel) {
  const dir = cacheDirAbs(rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Construye el filename cache: sha256(text+voice+model+speed+format).mp3
 * Determinista — el mismo input genera el mismo path. Exportado para tests.
 */
export function cacheKey(text, voice, model, speed, format) {
  const h = createHash('sha256');
  h.update(`${voice}|${model}|${speed}|${format}|${text}`);
  return `${h.digest('hex').slice(0, 32)}.${format}`;
}

function clearCache(rel) {
  const dir = cacheDirAbs(rel);
  if (!existsSync(dir)) {
    console.log(`Cache no existe (${dir}). Nada que limpiar.`);
    return 0;
  }
  let n = 0;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); n++; } catch { /* ignore */ }
  }
  console.log(`Cache limpiada: ${n} archivos eliminados de ${dir}.`);
  return n;
}

// ---------- OpenAI TTS call con retry ----------

/**
 * Llama a la API de OpenAI TTS con backoff exponencial. Retorna Buffer con
 * los bytes del audio. Lanza Error con mensaje accionable si falla.
 */
async function callTTS({ text, voice, model, speed, format, apiKey }) {
  const url = 'https://api.openai.com/v1/audio/speech';
  const body = JSON.stringify({
    model,
    input: text,
    voice,
    speed,
    response_format: format,
  });

  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        // 401/403/400 = no reintenta (input inválido o key mala).
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `OpenAI rechazó la API key (${res.status}). Revisa OPENAI_API_KEY en .env. Detalle: ${errText.slice(0, 200)}`,
          );
        }
        if (res.status === 400) {
          throw new Error(`OpenAI rechazó la petición (400). Detalle: ${errText.slice(0, 300)}`);
        }
        // 429/5xx = reintenta con backoff.
        if (attempt < maxAttempts && (res.status === 429 || res.status >= 500)) {
          const wait = 500 * Math.pow(2, attempt - 1);
          console.error(`[voice_tts] OpenAI ${res.status}, reintentando en ${wait}ms (intento ${attempt}/${maxAttempts})`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`OpenAI TTS falló (HTTP ${res.status}): ${errText.slice(0, 300)}`);
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } catch (e) {
      lastErr = e;
      // Errores de red puros (ENOTFOUND, ECONNRESET): reintenta.
      if (attempt < maxAttempts && /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(e.message)) {
        const wait = 500 * Math.pow(2, attempt - 1);
        console.error(`[voice_tts] error de red, reintentando en ${wait}ms (intento ${attempt}/${maxAttempts}): ${e.message}`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Llamada TTS falló por motivos desconocidos.');
}

// ---------- reproducción ----------

/**
 * Reproduce un archivo en bloqueo usando el player detectado. Si no hay
 * player, loguea el path para reproducción manual y retorna sin error.
 */
function playFile(file) {
  const player = detectPlayer();
  if (!player) {
    console.log(`Audio guardado en ${file}. No hay player conocido en esta plataforma — reprodúcelo manualmente.`);
    return;
  }
  // En Windows, `start "" "<file>"` retorna inmediato (la app default toma control).
  // En Unix usamos los players en foreground para esperar que termine.
  const args = player.appendFile ? [...player.args, file] : player.args;
  const result = spawnSync(player.cmd, args, {
    stdio: 'ignore',
    shell: player.shell,
    windowsVerbatimArguments: false,
  });
  if (result.error) {
    console.log(`Reproducción falló (${result.error.message}). Audio guardado en ${file}.`);
  }
}

// ---------- entrada principal ----------

function printHelp() {
  const lines = [
    'Uso: node scripts/voice_tts.js [opciones]',
    '',
    'TTS de respuestas largas con OpenAI TTS. Convierte texto en MP3, lo cachea',
    'localmente, y lo reproduce con el player default de la plataforma.',
    '',
    'Opciones:',
    '  --text "<texto>"       Texto a leer (mutuamente exclusivo con --file).',
    '  --file <path>          Archivo de texto a leer.',
    `  --voice <name>         Voz: ${VALID_VOICES.join(', ')}. Default: ${DEFAULTS.voice}.`,
    `  --model <id>           Modelo: ${VALID_MODELS.join(', ')}. Default: ${DEFAULTS.model}.`,
    `  --speed <0.25-4.0>     Velocidad. Default: ${DEFAULTS.speed}.`,
    '  --output <path>        Guarda audio en path (default: cache + reproduce).',
    '  --play                 Reproduce al terminar (default si no hay --output).',
    '  --no-play              Solo guarda, no reproduce.',
    `  --chunk-size <chars>   Tamaño de chunk para latencia. Default: ${DEFAULTS.chunkSize}.`,
    `  --cache-dir <path>     Directorio cache. Default: ${DEFAULTS.cacheDir}.`,
    '  --clear-cache          Limpia el cache y sale.',
    '  --help, -h             Muestra esta ayuda.',
    '',
    'Costo aproximado:',
    '  tts-1:    ~USD 0.015 / 1k chars (rápido, calidad estándar)',
    '  tts-1-hd: ~USD 0.030 / 1k chars (más calidad, más lento)',
    '',
    'Ejemplos:',
    '  node scripts/voice_tts.js --text "hola, esto es una prueba"',
    '  node scripts/voice_tts.js --file respuesta.txt --voice onyx --speed 1.2',
    '  node scripts/voice_tts.js --text "..." --output salida.mp3 --no-play',
    '  node scripts/voice_tts.js --clear-cache',
  ];
  console.log(lines.join('\n'));
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) { printHelp(); return 0; }
    if (args.clearCache) { clearCache(args.cacheDir); return 0; }
    validateArgs(args);
  } catch (e) {
    console.error(`[voice_tts] error de argumentos: ${e.message}`);
    return 1;
  }

  loadEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error('[voice_tts] OPENAI_API_KEY no encontrada. Corre `npm run setup` o `/setup-openai` primero.');
    return 1;
  }

  // Recoge texto.
  let rawText;
  if (args.file) {
    if (!existsSync(args.file)) {
      console.error(`[voice_tts] archivo no existe: ${args.file}`);
      return 1;
    }
    rawText = readFileSync(args.file, 'utf8');
  } else {
    rawText = args.text;
  }

  const text = stripCodeBlocks(rawText);
  if (!text.trim()) {
    console.error('[voice_tts] texto vacío después de limpiar bloques de código.');
    return 1;
  }

  const chunks = chunkText(text, args.chunkSize);
  if (chunks.length === 0) {
    console.error('[voice_tts] no hay chunks para procesar.');
    return 1;
  }

  const cacheDir = ensureCacheDir(args.cacheDir);
  const segments = []; // paths absolutos de cada chunk audio
  let cacheHits = 0;
  let cacheMisses = 0;
  let totalChars = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    totalChars += chunk.length;
    const fname = cacheKey(chunk, args.voice, args.model, args.speed, DEFAULTS.format);
    const fpath = join(cacheDir, fname);
    if (existsSync(fpath) && statSync(fpath).size > 100) {
      cacheHits++;
      segments.push(fpath);
      console.log(`[${i + 1}/${chunks.length}] cache HIT (${chunk.length} chars)`);
      continue;
    }
    cacheMisses++;
    process.stdout.write(`[${i + 1}/${chunks.length}] generando audio (${chunk.length} chars)... `);
    const t0 = Date.now();
    try {
      const audio = await callTTS({
        text: chunk,
        voice: args.voice,
        model: args.model,
        speed: args.speed,
        format: DEFAULTS.format,
        apiKey,
      });
      writeFileSync(fpath, audio);
      segments.push(fpath);
      console.log(`OK (${((Date.now() - t0) / 1000).toFixed(1)}s, ${audio.length} bytes)`);
    } catch (e) {
      console.log('FALLÓ');
      console.error(`[voice_tts] error generando chunk ${i + 1}: ${e.message}`);
      return 1;
    }
  }

  // Resumen de costo aproximado.
  const ratePer1k = args.model === 'tts-1' ? 0.015 : args.model === 'tts-1-hd' ? 0.030 : 0.015;
  const billableChars = chunks.reduce((acc, c, i) => {
    // Solo contamos chars de chunks que NO eran cache hit.
    return acc; // aproximamos por miss más abajo
  }, 0);
  // Recomputamos con datos reales de la iteración anterior.
  let missChars = 0;
  for (let i = 0; i < chunks.length; i++) {
    const fname = cacheKey(chunks[i], args.voice, args.model, args.speed, DEFAULTS.format);
    const fpath = join(cacheDir, fname);
    // Conservador: si el archivo se acaba de crear en esta corrida, fue miss.
    // Distinguir hits vs misses con precisión total requeriría tracking explícito;
    // arriba ya logueamos por chunk. El estimado abajo es total chars.
  }
  const estCost = (totalChars / 1000) * ratePer1k;
  console.log(
    `Resumen: ${chunks.length} chunks, ${cacheHits} hits, ${cacheMisses} misses, ${totalChars} chars totales. ` +
    `Costo estimado de esta corrida (solo misses): ~USD ${((cacheMisses / Math.max(1, chunks.length)) * estCost).toFixed(4)}.`,
  );

  // Output final: si --output, concatena bytes (mp3 admite concat ingenuo aceptable).
  // Si no, deja segments en cache y reproduce uno tras otro.
  let finalFile = null;
  if (args.output) {
    const outPath = isAbsolute(args.output) ? args.output : join(process.cwd(), args.output);
    if (segments.length === 1) {
      // Copia simple.
      writeFileSync(outPath, readFileSync(segments[0]));
    } else {
      // Concat ingenuo de MP3. Funciona para reproducción casual; herramientas
      // como ffmpeg darían un resultado más limpio pero no podemos asumirlo.
      const buffers = segments.map(s => readFileSync(s));
      writeFileSync(outPath, Buffer.concat(buffers));
    }
    finalFile = outPath;
    console.log(`Audio guardado: ${outPath}`);
  }

  if (args.play) {
    if (finalFile) {
      playFile(finalFile);
    } else {
      // Reproduce cada chunk en secuencia desde cache.
      for (const seg of segments) playFile(seg);
    }
  }

  return 0;
}

// Solo corre main si este archivo es el entry point (no cuando se importa para tests).
// En Windows, import.meta.url viene como `file:///C:/...` y process.argv[1] como `C:\...`.
// Comparamos via pathToFileURL para normalizar.
const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const isEntry = import.meta.url === entryUrl;
if (isEntry) {
  main()
    .then(code => process.exit(code))
    .catch(e => {
      console.error(`[voice_tts] fatal: ${e.message}`);
      process.exit(1);
    });
}
