import { createRequire } from 'node:module';
import { dirname, join, parse } from 'node:path';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const visited = new Set(); const notices = [];
function collect(name, from) {
  if (name.startsWith('@types/')) return;
  const require = createRequire(join(from, 'package.json'));
  let folder;
  try { folder = dirname(require.resolve(`${name}/package.json`)); }
  catch {
    try {
      folder = dirname(require.resolve(name));
      while (folder !== parse(folder).root) {
        try { if (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).name === name) break; } catch { /* Search the resolved entry's parents. */ }
        folder = dirname(folder);
      }
    } catch { return; }
  }
  folder = realpathSync(folder); if (visited.has(folder)) return; visited.add(folder);
  const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const files = readdirSync(folder).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file));
  notices.push(`${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n${files.map(file => `${file}\n${readFileSync(join(folder, file), 'utf8')}`).join('\n\n')}`);
  for (const dependency of Object.keys(pkg.dependencies || {})) collect(dependency, folder);
}
for (const dependency of Object.keys(manifest.dependencies)) collect(dependency, root);
notices.push('aria2 1.37.0\nLicense: GPL-2.0-or-later\nUnmodified upstream Windows executable, copyright Tatsuhiro Tsujikawa and contributors.\nThe full COPYING license, AUTHORS, pinned release provenance and corresponding upstream source archive are distributed in resources/aria2 alongside aria2c.exe.\nSource: https://github.com/aria2/aria2/releases/tag/release-1.37.0');
notices.push('7-Zip 26.05\nUnmodified 7z.exe and 7z.dll. Copyright (C) 1999-2026 Igor Pavlov.\nLicense, upstream source archive and provenance are included in resources/sevenzip.\nSource: https://github.com/ip7z/7zip/releases/tag/26.05\n'+readFileSync(join(root,'vendor/sevenzip/License.txt'),'utf8'));
writeFileSync(join(root, 'public', 'THIRD_PARTY_NOTICES.txt'), `Qidu Reader - Third-party components\nElectron/Chromium notices are included alongside the application executable.\n\n${notices.sort().join('\n\n' + '='.repeat(72) + '\n\n')}`);
