import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrix = JSON.parse(
  readFileSync(path.join(root, 'test/live/matrix.json'), 'utf8'),
);
const outDir = path.join(root, 'output');
mkdirSync(outDir, { recursive: true });
const lines = ['# Live smoke report', '', `Generated: ${new Date().toISOString()}`, ''];

for (const row of matrix) {
  const args = ['tsx', 'src/cli.ts', row.url, ...(row.args ?? [])];
  const res = spawnSync('npx', args, { cwd: root, encoding: 'utf8', shell: true });
  const ok = res.status === 0 || res.status === 2;
  lines.push(`## ${row.id}`);
  lines.push(`- URL: ${row.url}`);
  lines.push(`- Exit: ${res.status}`);
  lines.push(`- Pass: ${ok ? 'yes' : 'no'}`);
  if (res.stdout) {
    lines.push('```');
    lines.push(res.stdout.trim().slice(-800));
    lines.push('```');
  }
  lines.push('');
}

writeFileSync(path.join(outDir, 'live-report.md'), lines.join('\n'), 'utf8');
console.log('Wrote output/live-report.md');
