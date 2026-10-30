#!/usr/bin/env node
// Checks the traceability table in docs/hardware-validation.md: every
// scenario in the OpenSpec change's specs has a row, and every row names
// tests that exist or hardware checklist items that are defined.
//
//   node scripts/ci/check-traceability.mjs [doc] [--only capability,capability]
//
// A row is `| <scenario> | <coverage> |` under `### <capability>`. Coverage
// items are separated by `; ` and are either a test, written
// `` `path/to/file` › name `` (each `›`-separated part of the name must
// appear in the file), or a checklist id such as `HW-A7`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const specsDir = path.join(root, 'openspec/changes/rework-v2-new-architecture/specs');

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1].split(',')) : null;
const docPath = path.resolve(
  args.find((arg, index) => !arg.startsWith('--') && index !== onlyIndex + 1) ??
    path.join(root, 'docs/hardware-validation.md')
);

/** capability -> scenario names, in spec order. */
const scenarios = new Map();
for (const capability of readdirSync(specsDir).sort()) {
  if (only && !only.has(capability)) continue;
  const spec = readFileSync(path.join(specsDir, capability, 'spec.md'), 'utf8');
  scenarios.set(
    capability,
    [...spec.matchAll(/^#### Scenario: (.+)$/gm)].map(([, name]) => name.trim())
  );
}

const doc = readFileSync(docPath, 'utf8');
const checklist = new Set([...doc.matchAll(/^- \*\*(HW-[A-Z]+\d+)\*\*/gm)].map(([, id]) => id));

/** capability -> scenario -> coverage cell. */
const rows = new Map();
let section = null;
for (const line of doc.split('\n')) {
  const heading = line.match(/^### ([a-z-]+)\s*$/);
  if (heading) {
    section = heading[1];
    rows.set(section, rows.get(section) ?? new Map());
    continue;
  }
  if (section === null || !line.startsWith('|') || /^\|\s*-/.test(line)) continue;
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim().replaceAll('\\|', '|'));
  if (cells.length !== 2 || cells[0] === 'Scenario') continue;
  rows.get(section).set(cells[0], cells[1]);
}

const problems = [];
const fileCache = new Map();
const read = (file) => {
  if (!fileCache.has(file)) fileCache.set(file, readFileSync(path.join(root, file), 'utf8'));
  return fileCache.get(file);
};

for (const [capability, names] of scenarios) {
  const covered = rows.get(capability) ?? new Map();
  for (const name of names) {
    const cell = covered.get(name);
    if (cell === undefined || cell === '') {
      problems.push(`${capability}: no coverage for "${name}"`);
      continue;
    }
    for (const item of cell.split(/;\s+/)) {
      const test = item.match(/^`([^`]+)`\s*›\s*(.+)$/);
      if (test) {
        const [, file, testName] = test;
        if (!existsSync(path.join(root, file))) {
          problems.push(`${capability} / ${name}: ${file} does not exist`);
          continue;
        }
        for (const part of testName.split('›').map((p) => p.trim())) {
          if (!read(file).includes(part)) {
            problems.push(`${capability}: "${part}" not found in ${file}`);
          }
        }
      } else if (/^HW-[A-Z]+\d+$/.test(item)) {
        if (!checklist.has(item)) problems.push(`${capability} / ${name}: ${item} is not in the checklist`);
      } else {
        problems.push(`${capability} / ${name}: cannot read coverage item "${item}"`);
      }
    }
  }
  for (const name of covered.keys()) {
    if (!names.includes(name)) problems.push(`${capability}: "${name}" is not a scenario in the spec`);
  }
}

const total = [...scenarios.values()].reduce((sum, names) => sum + names.length, 0);
if (problems.length > 0) {
  console.error(`Traceability problems (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Every scenario (${total}) is traced to a test or a checklist item.`);
