import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoServerYaml = fileURLToPath(new URL('../../../server.yaml', import.meta.url));

/**
 * The repository's server.yaml in a temp file, with no alliances, so tests don't change whenever
 * the guild allies with someone. Returns the copy's path.
 */
export function copyRepoYaml(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
  const text = readFileSync(repoServerYaml, 'utf8').replace(
    /^alliances:[\s\S]*$/m,
    'alliances: []\n',
  );
  writeFileSync(path, text);
  return path;
}
