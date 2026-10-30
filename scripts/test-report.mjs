#!/usr/bin/env node
// Writes docs/test-report.md: every automated test case with its latest
// result, the traceability check and the mutation checks, so later runs can
// be compared with this one. scripts/test-report.sh runs the suites first.
//
//   node scripts/test-report.mjs --jest <jest --json output>
//     --android <JUnit XML directory> --ios <xUnit XML file> --env "<where it ran>"
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

const ICON = { passed: '✅', failed: '❌', skipped: '⏭️' };

/** groups: Map<group, Array<{ name, status }>> */
function tally(groups) {
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const cases of groups.values()) {
    for (const { status } of cases) {
      counts.total += 1;
      counts[status] += 1;
    }
  }
  return counts;
}

function readJest(file) {
  const groups = new Map();
  const report = JSON.parse(readFileSync(file, 'utf8'));
  for (const result of report.testResults) {
    const group = path.relative(root, result.name);
    groups.set(
      group,
      result.assertionResults.map((test) => ({
        name: [...test.ancestorTitles, test.title].join(' › '),
        status: test.status === 'passed' ? 'passed' : test.status === 'failed' ? 'failed' : 'skipped',
      }))
    );
  }
  return groups;
}

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');

/** JUnit/xUnit <testcase> elements, grouped by class name (short form). */
function readXml(files) {
  const groups = new Map();
  for (const file of files) {
    const xml = readFileSync(file, 'utf8');
    for (const [, attributes, body = ''] of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const attribute = (key) => decode(attributes.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? '');
      const group = attribute('classname').split('.').pop();
      const status = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ name: attribute('name'), status });
    }
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

function caseList(title, groups, label) {
  const lines = [`### ${title}`, ''];
  for (const [group, cases] of groups) {
    const { passed, failed, skipped } = tally(new Map([[group, cases]]));
    const parts = [`${passed} passed`, failed && `${failed} failed`, skipped && `${skipped} skipped`].filter(Boolean);
    lines.push(`<details><summary>${label(group)}: ${parts.join(', ')}</summary>`, '');
    for (const { name, status } of cases) lines.push(`- ${ICON[status]} ${name.replace(/\|/g, '\\|')}`);
    lines.push('', '</details>', '');
  }
  return lines;
}

const sections = [];
const summary = [];
const row = (suite, command, counts) =>
  summary.push(`| ${suite} | \`${command}\` | ${counts.total} | ${counts.passed} | ${counts.failed} | ${counts.skipped} |`);

const jestFile = arg('jest');
if (jestFile) {
  const groups = readJest(jestFile);
  row('JavaScript, Expo plugin, example (Jest)', 'yarn test', tally(groups));
  sections.push(...caseList('JavaScript (Jest)', groups, (group) => `\`${group}\``));
}
const androidDir = arg('android');
if (androidDir && existsSync(androidDir)) {
  const files = readdirSync(androidDir).filter((file) => file.endsWith('.xml')).map((file) => path.join(androidDir, file));
  const groups = readXml(files);
  row('Android (JVM and Robolectric)', 'yarn test:android', tally(groups));
  sections.push(
    ...caseList('Android (JVM and Robolectric)', groups, (group) => `\`${group}\``),
    'Robolectric runs some classes once per API level, so a case can appear more than once with the level in brackets.',
    ''
  );
}
const iosFile = arg('ios');
if (iosFile && existsSync(iosFile)) {
  const groups = readXml([iosFile]);
  row('iOS core (XCTest)', 'swift test (in ios/Core)', tally(groups));
  sections.push(...caseList('iOS core (XCTest)', groups, (group) => `\`${group}\``));
}

const trace = spawnSync('node', ['scripts/ci/check-traceability.mjs'], { cwd: root, encoding: 'utf8' });
const traced = (trace.stdout + trace.stderr).trim().split('\n').pop();

const mutationLines = [];
for (const suite of ['android', 'ios']) {
  const file = path.join(root, `scripts/mutation/results-${suite}.json`);
  if (!existsSync(file)) continue;
  const { commit, date, results } = JSON.parse(readFileSync(file, 'utf8'));
  const caught = results.filter((result) => result.caught).length;
  summary.push(
    `| Mutation checks, ${suite} | \`node scripts/mutation/run.mjs ${suite}\` | ${results.length} | ${caught} caught | ${results.length - caught} missed | |`
  );
  mutationLines.push(
    `### ${suite === 'android' ? 'Android' : 'iOS'}`,
    '',
    `Run on \`${commit}\`, ${date.slice(0, 10)}. Each mutation breaks one failure path; a test must fail.`,
    '',
    '| Mutation | File | Test class | Result |',
    '| --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.name} | \`${path.basename(result.file)}\` | ${result.test} | ${result.caught ? '✅ caught' : '❌ missed'} |`
    ),
    ''
  );
}

const output = [
  '# Test report',
  '',
  '<!-- Generated by scripts/test-report.mjs. Regenerate it with `yarn test:report`; do not edit by hand. -->',
  '',
  'Every automated test case and its latest result, the traceability check and the mutation checks, recorded so later runs can be compared with this one. Results on real devices are recorded in [hardware-validation.md](./hardware-validation.md#results).',
  '',
  `- **Commit:** \`${git('rev-parse', '--short', 'HEAD')}\`${git('status', '--porcelain') ? ' (with uncommitted changes)' : ''}`,
  `- **Run:** ${new Date().toISOString().slice(0, 10)}, ${arg('env') ?? 'environment not recorded'}`,
  '',
  '## Summary',
  '',
  '| Suite | Command | Cases | Passed | Failed | Skipped |',
  '| --- | --- | --- | --- | --- | --- |',
  ...summary,
  '',
  `Traceability (\`node scripts/ci/check-traceability.mjs\`): ${traced}`,
  '',
  '## Regenerating',
  '',
  '```sh',
  'yarn test:report                      # runs Jest, the Android tests and swift test, then writes this file',
  'node scripts/mutation/run.mjs android  # then ios; slow, and only needed when failure paths change',
  '```',
  '',
  'The Android tests need JDK 21; the iOS core tests need a Swift toolchain (Xcode, or swift.org on Linux, where the one Darwin-only I/O-thread test is skipped). A suite whose toolchain is missing is left out of the report.',
  '',
  ...(mutationLines.length > 0 ? ['## Mutation checks', '', ...mutationLines] : []),
  '## Test cases',
  '',
  ...sections,
];
const target = path.join(root, arg('out') ?? 'docs/test-report.md');
writeFileSync(target, `${output.join('\n').trimEnd()}\n`);
console.log(`Wrote ${path.relative(root, target)}`);
