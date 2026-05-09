import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, 'schemas');

let ajvInstance = null;
let loadedSchemaIds = null;

function getAjv() {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const ids = [];
  for (const file of readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith('.schema.json')) continue;
    const raw = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8'));
    const id = raw.$id || basename(file, '.schema.json');
    if (!raw.$id) raw.$id = id;
    ajv.addSchema(raw, id);
    ids.push(id);
  }
  ajvInstance = ajv;
  loadedSchemaIds = ids;
  return ajv;
}

export function listSchemas() {
  getAjv();
  return [...loadedSchemaIds];
}

// Translates ajv errors to one-line human messages so consumers can log them
// without re-implementing the same formatting in every agent.
function humanizeError(err) {
  const where = err.instancePath || '(root)';
  switch (err.keyword) {
    case 'required':
      return `falta el campo requerido "${err.params.missingProperty}" en ${where}`;
    case 'additionalProperties':
      return `campo no permitido "${err.params.additionalProperty}" en ${where}`;
    case 'enum':
      return `valor inválido en ${where}: se esperaba uno de [${err.params.allowedValues.join(', ')}]`;
    case 'type':
      return `tipo incorrecto en ${where}: se esperaba ${err.params.type}`;
    case 'minItems':
      return `el array en ${where} debe contener al menos ${err.params.limit} entrada(s)`;
    case 'minLength':
      return `el string en ${where} no puede estar vacío (mínimo ${err.params.limit} caracteres)`;
    case 'pattern':
      return `formato inválido en ${where}: no coincide con el patrón esperado`;
    case 'format':
      return `formato inválido en ${where}: se esperaba ${err.params.format}`;
    default:
      return `${err.keyword} falló en ${where}: ${err.message}`;
  }
}

export function validateOutput(schemaId, outputObject) {
  const ajv = getAjv();
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    return {
      valid: false,
      errors: [{
        message: `schema desconocido "${schemaId}". Schemas disponibles: ${listSchemas().join(', ')}`,
        path: '(schema)',
      }],
    };
  }
  const ok = validate(outputObject);
  if (ok) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: validate.errors.map(e => ({
      message: humanizeError(e),
      path: e.instancePath || '(root)',
      keyword: e.keyword,
    })),
  };
}

export function validateFile(schemaId, filePath) {
  if (!existsSync(filePath)) {
    return {
      valid: false,
      errors: [{ message: `archivo no encontrado: ${filePath}`, path: '(file)' }],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return {
      valid: false,
      errors: [{ message: `JSON inválido en ${filePath}: ${e.message}`, path: '(file)' }],
    };
  }
  return validateOutput(schemaId, parsed);
}

function runCli() {
  const [cmd, schemaArg, fileArg] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const id of listSchemas()) console.log(id);
    return 0;
  }
  if (cmd !== 'validate' || !schemaArg || !fileArg) {
    console.error('uso: node contracts/validator.js validate <schema-name> <output-file>');
    console.error('     node contracts/validator.js list');
    return 2;
  }
  const result = validateFile(schemaArg, fileArg);
  if (result.valid) {
    console.log(`OK  ${schemaArg}  ${fileArg}`);
    return 0;
  }
  console.error(`FAIL  ${schemaArg}  ${fileArg}`);
  for (const err of result.errors) {
    console.error(`  - ${err.message}`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validator.js')) {
  process.exit(runCli());
}
