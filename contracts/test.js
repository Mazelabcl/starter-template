import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateOutput } from './validator.js';
import { emitOutput, consumeInput, declareContract, ContractViolation } from './helpers.js';

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${e.message}`);
    failed += 1;
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'contracts-test-'));

try {
  check('caso éxito: ArchitectAlpha emite output válido y CriticBeta lo consume', () => {
    declareContract({
      agent: 'ArchitectAlpha',
      inputs: [{ schema: 'research-output', path: 'content/research/topic.json', optional: true }],
      outputs: [{ schema: 'architect-output', path: 'content/architect/proposal.json' }],
      preconditions: ['principles.md existe'],
      postconditions: ['un proposal por section listado en INDEX.md'],
    });

    const validOutput = {
      agent: 'ArchitectAlpha',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      artifact_kind: 'capitulo',
      title: 'Capítulo 1 — Apertura',
      summary: 'Establece el tono y presenta al protagonista.',
      sections: [
        { id: 's1', heading: 'Hook inicial', intent: 'capturar atención en 2 párrafos' },
        { id: 's2', heading: 'Setup', intent: 'introducir el conflicto', depends_on: ['s1'] },
      ],
      references: [
        { kind: 'principles', path: 'content/principles.md' },
      ],
    };

    const outPath = join(tmp, 'architect-proposal.json');
    const meta = emitOutput('ArchitectAlpha', 'architect-output', validOutput, outPath);
    if (!meta.path) throw new Error('emitOutput no retornó path');

    const consumed = consumeInput('CriticBeta', 'architect-output', outPath);
    if (consumed.title !== validOutput.title) throw new Error('consumeInput devolvió data inconsistente');
  });

  check('caso fallo: output inválido es rechazado por el consumer con mensaje claro', () => {
    const broken = {
      agent: 'ArchitectAlpha',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      artifact_kind: 'capitulo',
      // falta "title" y "sections"
    };
    const brokenPath = join(tmp, 'architect-broken.json');
    writeFileSync(brokenPath, JSON.stringify(broken, null, 2), 'utf8');

    let caught = null;
    try {
      consumeInput('CriticBeta', 'architect-output', brokenPath);
    } catch (e) {
      caught = e;
    }
    if (!caught) throw new Error('consumeInput debería haber lanzado ContractViolation');
    if (!(caught instanceof ContractViolation)) {
      throw new Error(`error esperado ContractViolation, recibido ${caught.constructor.name}`);
    }
    if (!/title/.test(caught.message) && !/sections/.test(caught.message)) {
      throw new Error(`mensaje no menciona el campo faltante: ${caught.message}`);
    }
    console.log(`      mensaje recibido (correcto): ${caught.message.split('\n')[0]}`);
  });

  check('caso edge: schema desconocido retorna error informativo', () => {
    const result = validateOutput('schema-que-no-existe', { foo: 'bar' });
    if (result.valid) throw new Error('debería haber fallado');
    const msg = result.errors[0]?.message || '';
    if (!/desconocido/.test(msg)) {
      throw new Error(`mensaje no informativo sobre schema desconocido: ${msg}`);
    }
    if (!/Schemas disponibles/.test(msg)) {
      throw new Error('mensaje debería listar schemas disponibles');
    }
    console.log(`      mensaje recibido (correcto): ${msg}`);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
