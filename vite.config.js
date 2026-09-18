import {defineConfig} from 'vite';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {localApi} from './tools/local-api.mjs';
import {localScene} from './tools/local-scene.mjs';
export default defineConfig({plugins:[localApi(),localScene(),{name:'worker-build',async closeBundle(){mkdirSync('dist/server',{recursive:true});await build({entryPoints:['server/index.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});}}],build:{outDir:'dist/client',emptyOutDir:true}});
