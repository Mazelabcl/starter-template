// dashboard-hooks.test.js
// Verifica:
//   1. .claude/settings.json existe, parsea como JSON, y tiene hooks PreToolUse + PostToolUse con matcher "Agent".
//   2. scripts/dashboard_hook.js existe, parsea sin error de sintaxis, y exporta helpers.
//   3. extractRole, extractTitle, extractAgentName, detectFailure y buildCommand se comportan como deberían.
//   4. Al spawn-ear el hook con un JSON mock de PreToolUse, llega a invocar update_state.js task-start.
//
// Se ejecuta con: node dashboard-hooks.test.js

import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const SETTINGS_PATH = join(REPO_ROOT, '.claude', 'settings.json');
const HOOK_PATH = join(REPO_ROOT, 'scripts', 'dashboard_hook.js');
const UPDATE_STATE_PATH = join(REPO_ROOT, 'scripts', 'update_state.js');
const CACHE_DIR = join(REPO_ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'active-agents.json');
const STATE_PATH = join(REPO_ROOT, 'dashboard', 'state.json');

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

function tryFn(name, fn) {
  try { fn(); record(name, true); }
  catch (e) { record(name, false, e.message); }
}

// -------- 1) settings.json --------

tryFn('settings.json existe', () => {
  if (!existsSync(SETTINGS_PATH)) throw new Error(`no existe ${SETTINGS_PATH}`);
});

let settings;
tryFn('settings.json parsea como JSON', () => {
  const raw = readFileSync(SETTINGS_PATH, 'utf8');
  settings = JSON.parse(raw);
});

tryFn('settings.json tiene hooks.PreToolUse con matcher Agent', () => {
  const arr = settings && settings.hooks && settings.hooks.PreToolUse;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('falta hooks.PreToolUse');
  const has = arr.some(h => h.matcher === 'Agent' && Array.isArray(h.hooks) && h.hooks.length > 0);
  if (!has) throw new Error('PreToolUse no matchea Agent o no tiene hooks');
});

tryFn('settings.json tiene hooks.PostToolUse con matcher Agent', () => {
  const arr = settings && settings.hooks && settings.hooks.PostToolUse;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('falta hooks.PostToolUse');
  const has = arr.some(h => h.matcher === 'Agent' && Array.isArray(h.hooks) && h.hooks.length > 0);
  if (!has) throw new Error('PostToolUse no matchea Agent o no tiene hooks');
});

tryFn('hooks invocan dashboard_hook.js con modo pre y post', () => {
  const pre = settings.hooks.PreToolUse[0].hooks[0].command;
  const post = settings.hooks.PostToolUse[0].hooks[0].command;
  if (!/dashboard_hook\.js.*\bpre\b/.test(pre)) throw new Error(`pre command sospechoso: ${pre}`);
  if (!/dashboard_hook\.js.*\bpost\b/.test(post)) throw new Error(`post command sospechoso: ${post}`);
});

// -------- 2) dashboard_hook.js --------

tryFn('dashboard_hook.js existe', () => {
  if (!existsSync(HOOK_PATH)) throw new Error(`no existe ${HOOK_PATH}`);
});

tryFn('dashboard_hook.js parsea sin syntax error', () => {
  // node --check valida sintaxis sin ejecutar el módulo
  const r = spawnSync(process.execPath, ['--check', HOOK_PATH], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`syntax error: ${r.stderr || r.stdout}`);
});

// -------- 3) helpers exportados --------

let mod;
async function importHelpers() {
  try {
    mod = await import('./scripts/dashboard_hook.js');
    for (const k of ['extractRole', 'extractTitle', 'extractAgentName', 'detectFailure', 'buildCommand']) {
      if (typeof mod[k] !== 'function') throw new Error(`falta export ${k}`);
    }
    record('dashboard_hook.js importa helpers', true);
  } catch (e) {
    record('dashboard_hook.js importa helpers', false, e.message);
  }
}

// Como tryFn no es async, ejecutamos los siguientes asserts después.
async function helperTests() {
  if (!mod) {
    record('helpers tests', false, 'mod no se importó');
    return;
  }

  tryFn('extractRole capta "ROL: <texto>"', () => {
    const r = mod.extractRole('ROL: Eres un Claude Code expert que sabe hooks.\n\nCONTEXTO:...');
    if (!/Claude Code expert/i.test(r)) throw new Error(`role inesperado: ${r}`);
    if (r.length > 100) throw new Error(`role no truncado: len=${r.length}`);
  });

  tryFn('extractRole fallback a primer renglón', () => {
    const r = mod.extractRole('Investiga la documentación de hooks\nLuego haz X');
    if (!/Investiga/.test(r)) throw new Error(`fallback inesperado: ${r}`);
  });

  tryFn('extractRole prompt vacío', () => {
    const r = mod.extractRole('');
    if (!r || typeof r !== 'string') throw new Error('debería retornar string default');
  });

  tryFn('extractTitle usa description si existe', () => {
    const t = mod.extractTitle({ description: 'Buscar endpoints', prompt: 'lalala' });
    if (t !== 'Buscar endpoints') throw new Error(`title inesperado: ${t}`);
  });

  tryFn('extractAgentName usa subagent_type', () => {
    const a = mod.extractAgentName({ subagent_type: 'Explore' });
    if (a !== 'Explore') throw new Error(`agent inesperado: ${a}`);
  });

  tryFn('detectFailure detecta is_error true', () => {
    const r = mod.detectFailure({ is_error: true, error: 'tool failed' });
    if (!r) throw new Error('debería detectar fallo');
  });

  tryFn('detectFailure null cuando todo OK', () => {
    const r = mod.detectFailure({ content: 'todo ok' });
    if (r !== null) throw new Error(`falso positivo: ${r}`);
  });

  tryFn('buildCommand pre genera task-start con id', () => {
    const out = mod.buildCommand('pre', {
      tool_name: 'Agent',
      tool_use_id: 'toolu_test_1',
      tool_input: {
        subagent_type: 'general-purpose',
        description: 'Test task',
        prompt: 'ROL: Eres un agente de prueba. Tu tarea es...',
      },
    }, {});
    if (!out.args || out.args[0] !== 'task-start') throw new Error('args[0] !== task-start');
    if (!out.args[1].startsWith('agent-')) throw new Error(`task id mal: ${out.args[1]}`);
    if (out.args[2] !== 'general-purpose') throw new Error(`agent name mal: ${out.args[2]}`);
    if (!/agente de prueba/i.test(out.args[3])) throw new Error(`role mal: ${out.args[3]}`);
    if (out.args[4] !== 'Test task') throw new Error(`title mal: ${out.args[4]}`);
    if (!out.newCache['toolu_test_1']) throw new Error('cache no guardó correlación');
  });

  tryFn('buildCommand post correlaciona y genera task-complete', () => {
    const cache = { 'toolu_test_2': { task_id: 'agent-xyz', agent: 'foo', created_at: Date.now() } };
    const out = mod.buildCommand('post', {
      tool_name: 'Agent',
      tool_use_id: 'toolu_test_2',
      tool_response: { content: 'ok' },
    }, cache);
    if (!out.args || out.args[0] !== 'task-complete') throw new Error(`expected task-complete, got ${out.args && out.args[0]}`);
    if (out.args[1] !== 'agent-xyz') throw new Error(`task id mal: ${out.args[1]}`);
    if (out.newCache['toolu_test_2']) throw new Error('cache no se limpió');
  });

  tryFn('buildCommand post genera task-fail si tool_response.is_error', () => {
    const cache = { 'toolu_test_3': { task_id: 'agent-fail', agent: 'foo', created_at: Date.now() } };
    const out = mod.buildCommand('post', {
      tool_name: 'Agent',
      tool_use_id: 'toolu_test_3',
      tool_response: { is_error: true, error: 'algo explotó' },
    }, cache);
    if (!out.args || out.args[0] !== 'task-fail') throw new Error(`expected task-fail, got ${out.args && out.args[0]}`);
    if (out.args[1] !== 'agent-fail') throw new Error(`task id mal: ${out.args[1]}`);
    if (!/algo explotó/.test(out.args[2])) throw new Error(`reason mal: ${out.args[2]}`);
  });

  tryFn('buildCommand post sin correlación → no-op', () => {
    const out = mod.buildCommand('post', {
      tool_name: 'Agent',
      tool_use_id: 'toolu_unknown',
      tool_response: { content: 'ok' },
    }, {});
    if (out.args !== null) throw new Error('debería retornar args=null cuando no hay correlación');
  });
}

// -------- 4) integración: spawn del hook con stdin mock --------

async function integrationTest() {
  // backup state.json + cache si existen
  let stateBackup = null;
  if (existsSync(STATE_PATH)) stateBackup = readFileSync(STATE_PATH, 'utf8');
  let cacheBackup = null;
  if (existsSync(CACHE_FILE)) cacheBackup = readFileSync(CACHE_FILE, 'utf8');

  // limpiamos cache para empezar fresh
  try { if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE); } catch { /* ignore */ }

  const fakeToolUseId = `toolu_test_${Date.now()}`;
  const preInput = JSON.stringify({
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: fakeToolUseId,
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Hook integration test',
      prompt: 'ROL: Probar que el hook escribe a state.json. Idioma: español neutro.',
    },
  });

  // ejecutamos pre
  const pre = spawnSync(process.execPath, [HOOK_PATH, 'pre'], {
    input: preInput,
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 8000,
  });

  tryFn('hook pre exit code 0 (fail-safe)', () => {
    if (pre.status !== 0) throw new Error(`exit ${pre.status}: ${pre.stderr}`);
  });

  tryFn('hook pre persistió correlación en cache', () => {
    if (!existsSync(CACHE_FILE)) throw new Error('no se creó .cache/active-agents.json');
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (!cache[fakeToolUseId]) throw new Error(`falta entrada para ${fakeToolUseId}`);
  });

  let taskIdRegistered = null;
  tryFn('hook pre escribió tarea running en state.json', () => {
    if (!existsSync(STATE_PATH)) throw new Error('state.json desapareció');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    const taskId = cache[fakeToolUseId].task_id;
    taskIdRegistered = taskId;
    const task = (state.active_tasks || []).find(t => t.id === taskId);
    if (!task) throw new Error(`no se encontró tarea ${taskId} en active_tasks`);
    if (task.status !== 'running') throw new Error(`status esperado running, got ${task.status}`);
    if (!/Probar que el hook/i.test(task.agent_role || '')) throw new Error(`role no extraído: ${task.agent_role}`);
  });

  // ejecutamos post
  const postInput = JSON.stringify({
    session_id: 'test-session',
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: fakeToolUseId,
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Hook integration test',
    },
    tool_response: { type: 'text', content: 'agente terminó ok' },
  });

  const post = spawnSync(process.execPath, [HOOK_PATH, 'post'], {
    input: postInput,
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 8000,
  });

  tryFn('hook post exit code 0', () => {
    if (post.status !== 0) throw new Error(`exit ${post.status}: ${post.stderr}`);
  });

  tryFn('hook post marcó tarea completed', () => {
    if (!taskIdRegistered) throw new Error('pre no registró taskId — skip');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    const task = (state.active_tasks || []).find(t => t.id === taskIdRegistered);
    if (!task) throw new Error(`tarea ${taskIdRegistered} desapareció`);
    if (task.status !== 'completed') throw new Error(`status esperado completed, got ${task.status}`);
  });

  tryFn('hook post limpió la correlación del cache', () => {
    if (!existsSync(CACHE_FILE)) return; // si no existe, ok
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (cache[fakeToolUseId]) throw new Error('correlación no se limpió');
  });

  // -- caso de fail --
  const failToolUseId = `toolu_fail_${Date.now()}`;
  const preFailInput = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: failToolUseId,
    tool_input: {
      subagent_type: 'Explore',
      description: 'Tarea que falla',
      prompt: 'ROL: agente de prueba que va a fallar.',
    },
  });
  spawnSync(process.execPath, [HOOK_PATH, 'pre'], { input: preFailInput, encoding: 'utf8', cwd: REPO_ROOT, timeout: 8000 });

  const postFailInput = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: failToolUseId,
    tool_input: { subagent_type: 'Explore' },
    tool_response: { is_error: true, error: 'subagente reportó error' },
  });
  spawnSync(process.execPath, [HOOK_PATH, 'post'], { input: postFailInput, encoding: 'utf8', cwd: REPO_ROOT, timeout: 8000 });

  tryFn('flujo de fallo marca tarea como failed', () => {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    const failed = (state.active_tasks || []).find(t => t.status === 'failed' && /subagente reportó error/i.test(t.failure_reason || ''));
    if (!failed) throw new Error('no se encontró tarea failed con la razón esperada');
  });

  // -- fail-safe: input no-JSON --
  const garbage = spawnSync(process.execPath, [HOOK_PATH, 'pre'], {
    input: '<<no es json>>',
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 4000,
  });
  tryFn('hook fail-safe ante stdin basura (exit 0)', () => {
    if (garbage.status !== 0) throw new Error(`exit ${garbage.status}`);
  });

  // restore
  if (stateBackup) writeFileSync(STATE_PATH, stateBackup, 'utf8');
  if (cacheBackup) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, cacheBackup, 'utf8');
  } else {
    try { if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE); } catch { /* ignore */ }
  }
}

// -------- runner --------

async function run() {
  await importHelpers();
  // helpers async tests
  await helperTests();
  // integración
  await integrationTest();

  const failed = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  if (failed.length > 0) {
    console.log('\nFAILED:');
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  } else {
    console.log('Todos los checks PASS.');
    process.exit(0);
  }
}

run().catch(e => {
  console.error('Test runner crash:', e);
  process.exit(1);
});
