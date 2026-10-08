import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/epub/style.css');
const dest = join(root, 'dist/epub/style.css');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
