const Mocha = require('mocha');
const path = require('path');
const fs = require('fs');

const mocha = new Mocha({
  ui: 'tdd',
  timeout: 10000,
  reporter: 'spec',
});

const suiteDir = path.join(__dirname, '../dist/test/suite');
const testFiles = [
  'strategies.test.js',
  'kvCache.test.js',
  'pruner.test.js',
  'cache.test.js',
  'callLog.test.js',
  'formatters.test.js',
  'lifetimeStore.test.js',
];

for (const f of testFiles) {
  const p = path.join(suiteDir, f);
  if (fs.existsSync(p)) {
    mocha.addFile(p);
  }
}

mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
  console.log(`\nTests finished with ${failures} failure(s).`);
});
