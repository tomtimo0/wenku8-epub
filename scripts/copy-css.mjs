import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/epub/style.css');
const dest = join(root, 'dist/epub/style.css');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);

const builtinSrc = join(root, 'src/sites/rules/builtin');
const builtinDest = join(root, 'dist/sites/rules/builtin');
mkdirSync(builtinDest, { recursive: true });
for (const f of readdirSync(builtinSrc)) {
  if (f.endsWith('.json')) {
    copyFileSync(join(builtinSrc, f), join(builtinDest, f));
  }
}
