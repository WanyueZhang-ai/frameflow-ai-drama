import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd();const files=['server.mjs','src/providers.mjs','dist/app.mjs','dist/lib/engine.mjs','dist/lib/demo.mjs','dist/portal.mjs','dist/connect.mjs','dist/lib/model.mjs','dist/lib/memory.mjs','dist/lib/memory-ui.mjs','dist/lib/browser-providers.mjs','dist/lib/browser-media.mjs'];
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(1);}
for(const file of ['dist/index.html','dist/studio.html','dist/portal.css','dist/style.css','dist/memory.css','dist/assets/favicon.svg','dist/assets/rain-store.webp'])if(!fs.existsSync(path.join(root,file)))throw new Error(`Missing ${file}`);
console.log('Syntax and essential assets verified.');
