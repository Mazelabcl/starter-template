import { createInterface } from 'readline';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const ENV_PATH = '.env';

console.log('\nSetup de OpenRouter\n');
console.log('Para conseguir tu API key: https://openrouter.ai/keys');
console.log('Formato esperado: sk-or-v1-...\n');

const key = (await ask('Pega tu OpenRouter API key: ')).trim();

if (!key.startsWith('sk-or-v1-')) {
  console.warn('Aviso: la key no empieza con "sk-or-v1-". Continuando igual.');
}

let envContent = '';
if (existsSync(ENV_PATH)) {
  envContent = readFileSync(ENV_PATH, 'utf8');
  if (envContent.match(/^OPENROUTER_API_KEY=/m)) {
    envContent = envContent.replace(/^OPENROUTER_API_KEY=.*$/m, `OPENROUTER_API_KEY=${key}`);
  } else {
    envContent += `\nOPENROUTER_API_KEY=${key}\n`;
  }
} else {
  envContent = `OPENROUTER_API_KEY=${key}\n`;
}

writeFileSync(ENV_PATH, envContent);
console.log('\nGuardado en .env');
console.log('\nProbar: node src/research.js quick "qué hora es en Tokio"\n');
rl.close();
