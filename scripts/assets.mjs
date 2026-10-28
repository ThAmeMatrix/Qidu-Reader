import {ensureDownloadEngine} from './download-engine.mjs';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './notices.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  const destination = path.join(root, 'public/pdf-assets', folder);
  mkdirSync(destination, { recursive: true });
  cpSync(path.join(root, 'node_modules/pdfjs-dist', folder), destination, { recursive: true });
}

await ensureDownloadEngine();
