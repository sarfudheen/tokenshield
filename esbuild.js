// @ts-check
const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const commonOptions = {
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  logLevel: 'info',
  plugins: [],
};

/** @type {esbuild.BuildOptions} */
const extensionOptions = {
  ...commonOptions,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
};

// Standalone MCP cache server — runs as a plain node process, no vscode module.
/** @type {esbuild.BuildOptions} */
const cacheServerOptions = {
  ...commonOptions,
  entryPoints: ['src/mcp-server/cache-server.ts'],
  outfile: 'dist/cache-server.js',
};

async function main() {
  if (watch) {
    const contexts = await Promise.all([esbuild.context(extensionOptions), esbuild.context(cacheServerOptions)]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[watch] build started');
  } else {
    await Promise.all([esbuild.build(extensionOptions), esbuild.build(cacheServerOptions)]);
    console.log('[build] complete');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
