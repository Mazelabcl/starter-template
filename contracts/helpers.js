import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { validateOutput } from './validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DECLARED_DIR = join(__dirname, 'declared');

export class ContractViolation extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ContractViolation';
    this.details = details;
  }
}

function formatErrors(errors) {
  return errors.map(e => `  - ${e.message}`).join('\n');
}

export function emitOutput(agentName, schemaId, output, outputPath) {
  if (!agentName) throw new Error('emitOutput: agentName requerido');
  if (!schemaId) throw new Error('emitOutput: schemaId requerido');
  if (!outputPath) throw new Error('emitOutput: outputPath requerido');

  const result = validateOutput(schemaId, output);
  if (!result.valid) {
    throw new ContractViolation(
      `agente "${agentName}" produjo output inválido contra schema "${schemaId}":\n${formatErrors(result.errors)}`,
      { agent: agentName, schemaId, errors: result.errors, phase: 'emit' }
    );
  }

  const absPath = resolve(outputPath);
  mkdirSync(dirname(absPath), { recursive: true });
  const json = JSON.stringify(output, null, 2);
  writeFileSync(absPath, json + '\n', 'utf8');

  // We return enough metadata for the orchestrator to update state.json elsewhere
  // without re-reading the file. state.json updates are out of scope for this block.
  return {
    agent: agentName,
    schemaId,
    path: absPath,
    bytes: Buffer.byteLength(json, 'utf8'),
    written_at: new Date().toISOString(),
  };
}

export function consumeInput(agentName, expectedSchemaId, inputPath) {
  if (!agentName) throw new Error('consumeInput: agentName requerido');
  if (!expectedSchemaId) throw new Error('consumeInput: expectedSchemaId requerido');
  if (!inputPath) throw new Error('consumeInput: inputPath requerido');

  const absPath = resolve(inputPath);
  if (!existsSync(absPath)) {
    throw new ContractViolation(
      `agente "${agentName}" no puede consumir input: archivo inexistente "${absPath}"`,
      { agent: agentName, schemaId: expectedSchemaId, path: absPath, phase: 'consume' }
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (e) {
    throw new ContractViolation(
      `agente "${agentName}" no puede consumir input "${absPath}": JSON inválido (${e.message})`,
      { agent: agentName, schemaId: expectedSchemaId, path: absPath, phase: 'consume' }
    );
  }

  const result = validateOutput(expectedSchemaId, parsed);
  if (!result.valid) {
    throw new ContractViolation(
      `agente "${agentName}" rechaza input "${absPath}" — no cumple schema "${expectedSchemaId}":\n${formatErrors(result.errors)}`,
      { agent: agentName, schemaId: expectedSchemaId, path: absPath, errors: result.errors, phase: 'consume' }
    );
  }

  return parsed;
}

export function declareContract({ agent, inputs = [], outputs = [], preconditions = [], postconditions = [] }) {
  if (!agent) throw new Error('declareContract: agent requerido');
  if (!Array.isArray(inputs) || !Array.isArray(outputs)) {
    throw new Error('declareContract: inputs y outputs deben ser arrays');
  }

  const contract = {
    agent,
    declared_at: new Date().toISOString(),
    inputs: inputs.map(normalizeIO),
    outputs: outputs.map(normalizeIO),
    preconditions,
    postconditions,
  };

  mkdirSync(DECLARED_DIR, { recursive: true });
  const outPath = join(DECLARED_DIR, `${agent}.json`);
  writeFileSync(outPath, JSON.stringify(contract, null, 2) + '\n', 'utf8');
  return { agent, path: outPath };
}

function normalizeIO(io) {
  if (!io || typeof io !== 'object') {
    throw new Error('declareContract: cada input/output debe ser objeto {schema, path, optional?}');
  }
  if (!io.schema || !io.path) {
    throw new Error('declareContract: cada input/output requiere {schema, path}');
  }
  return {
    schema: io.schema,
    path: io.path,
    optional: io.optional === true,
    note: io.note || undefined,
  };
}

// Convenience used by pipeline-v2 in Sprint 1.3 to assert a precondition file exists
// before launching an agent. Kept minimal on purpose.
export function assertFileExists(label, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new ContractViolation(
      `precondición fallida: ${label} no encontrado en "${filePath}"`,
      { label, path: filePath, phase: 'precondition' }
    );
  }
}
