#!/usr/bin/env node
// Mutation check for the native code: each entry in scripts/mutation/<suite>.json
// breaks one failure path (replaces `old` with `new` in `file`), runs the test
// class named in `test`, and records whether a test failed, as it must. Every
// file is restored, with a fresh modification time so build caches notice.
//
//   node scripts/mutation/run.mjs android|ios [--only name,name]
//
// android needs the example's Gradle setup (JDK 21); ios needs a Swift
// toolchain (Xcode, or swift.org's on Linux). Results go to
// scripts/mutation/results-<suite>.json, which docs/test-report.md includes.
import { spawnSync } from 'node:child_process';
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const suite = process.argv[2];
const SUITES = {
  android: {
    cwd: 'example/android',
    command: (test) => [
      './gradlew',
      [':dynlabs_react-native-bluetooth-classic:testDebugUnitTest', '--tests', `kjd.reactnative.bluetooth.${test}`, '-q'],
    ],
  },
  ios: { cwd: 'ios/Core', command: (test) => ['swift', ['test', '--filter', test]] },
};
if (!(suite in SUITES)) {
  console.error('Usage: node scripts/mutation/run.mjs android|ios [--only name,name]');
  process.exit(2);
}
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > 0 ? new Set(process.argv[onlyIndex + 1].split(',')) : null;
const mutations = JSON.parse(readFileSync(path.join(root, `scripts/mutation/${suite}.json`), 'utf8')).filter(
  (mutation) => only === null || only.has(mutation.name)
);

function runTests(test) {
  const [command, args] = SUITES[suite].command(test);
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: path.join(root, SUITES[suite].cwd), encoding: 'utf8', timeout: 900_000 });
  return { passed: result.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
}

function touch(file) {
  const now = new Date();
  utimesSync(file, now, now);
}

// Every test class must pass before anything is broken, or a "caught" means nothing.
for (const test of new Set(mutations.map((mutation) => mutation.test))) {
  if (!runTests(test).passed) {
    console.error(`${test} fails without any mutation; fix it first.`);
    process.exit(1);
  }
}

const results = [];
for (const mutation of mutations) {
  const file = path.join(root, mutation.file);
  const source = readFileSync(file, 'utf8');
  if (source.split(mutation.old).length !== 2) {
    console.error(`${mutation.name}: the text to replace must occur exactly once in ${mutation.file}`);
    process.exit(1);
  }
  writeFileSync(file, source.replace(mutation.old, mutation.new));
  let outcome;
  try {
    outcome = runTests(mutation.test);
  } finally {
    writeFileSync(file, source);
    touch(file);
  }
  const caught = !outcome.passed;
  results.push({ name: mutation.name, file: mutation.file, test: mutation.test, caught, seconds: outcome.seconds });
  console.log(`${mutation.name.padEnd(26)} ${caught ? 'CAUGHT' : 'MISSED'} (${mutation.test}, ${outcome.seconds}s)`);
}

const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
writeFileSync(
  path.join(root, `scripts/mutation/results-${suite}.json`),
  `${JSON.stringify({ suite, commit, date: new Date().toISOString(), results }, null, 2)}\n`
);
const missed = results.filter((result) => !result.caught);
console.log(`${results.length - missed.length}/${results.length} caught.`);
process.exit(missed.length > 0 ? 1 : 0);
