const path = require('path');
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: [path.join(__dirname, '../browser/document-parser.js')],
  outfile: path.join(__dirname, '../public/document-parser.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  minify: true,
  legalComments: 'linked',
}).catch(() => process.exit(1));
