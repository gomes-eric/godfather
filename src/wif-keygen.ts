import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CLAUDE_AUDIENCE, generateSigningKey, loadSigningKey, publicJwk } from './core/wif-jwt.js';
import { WIF_SUBJECT, wifKeyPath } from './services/claude.js';

const path = wifKeyPath(process.env.DATABASE_PATH ?? './data/padrinho.db');
const issuer = process.env.PUBLIC_BASE_URL;

const created = !existsSync(path);
if (created) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateSigningKey(), { mode: 0o600 });
}
const jwk = publicJwk(loadSigningKey(readFileSync(path, 'utf8')));

console.log(`Chave ${created ? 'criada' : 'já existente'}: ${path}`);
console.log('');
console.log('Claude Console → Workload identity → registrar emissor');
console.log(`  URL do emissor: ${issuer ?? '(defina PUBLIC_BASE_URL)'}`);
console.log('  Fonte JWKS: inline. Cole as chaves:');
console.log(JSON.stringify([jwk], null, 2));
console.log('');
console.log('Regra de federação');
console.log(`  subject_prefix: ${WIF_SUBJECT}`);
console.log(`  audience: ${CLAUDE_AUDIENCE}`);
console.log('  escopo: workspace:developer');
