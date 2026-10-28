import {createHash} from 'node:crypto';
import {ensureDownloadEngine} from './download-engine.mjs';
import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDirectory = await ensureDownloadEngine();
const archiveProvenance=JSON.parse(await readFile(path.join(root,'vendor/sevenzip/provenance.json'),'utf8'));
for(const [name,hash] of Object.entries(archiveProvenance.runtime)){if(createHash('sha256').update(await readFile(path.join(root,'vendor/sevenzip',name))).digest('hex')!==hash)throw new Error('Archive runtime checksum mismatch: '+name);}
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
const stage = path.join(root, '.packaging', `app-${Date.now()}`);
await mkdir(stage, { recursive: true });
for (const folder of ['dist', 'electron', 'build']) await cp(path.join(root, folder), path.join(stage, folder), { recursive: true });
// All renderer dependencies are bundled by Vite; the desktop entry uses Node built-ins.
// A separate project and the builder's traversal collector prevent bundling build dependencies.
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, description: metadata.description, author: metadata.author, main: metadata.main, packageManager: 'traversal@1.0.0' }, null, 2));
await build({
  projectDir: stage,
  targets: Platform.WINDOWS.createTarget(process.argv.includes('--dir') ? 'dir' : 'portable', Arch.x64),
  config: {
    ...metadata.build,
    directories: { output: path.join(root, 'release') },
    electronDist: path.join(root, 'node_modules/electron/dist'), electronVersion: electronPackage.version,
    extraResources: [{from:path.join(root,'vendor/sevenzip'),to:'sevenzip',filter:['7z.exe','7z.dll','License.txt','readme.txt','provenance.json','7z2605-src.tar.xz']},{from:engineDirectory,to:'aria2',filter:['aria2c.exe','COPYING','AUTHORS','README.html','provenance.json','aria2-1.37.0.tar.xz']}],
    npmRebuild: false, files: ['dist/**/*', 'electron/**/*', 'build/icon.ico', 'package.json'],
  },
});
