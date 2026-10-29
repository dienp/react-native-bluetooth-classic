#!/usr/bin/env node
// Checks that the example app's merged Android manifest declares exactly the
// Bluetooth and location entries documented in docs/android.md, between the
// manifest-check markers. Run it after building the example for Android.
//
//   node scripts/ci/check-android-manifest.mjs [merged AndroidManifest.xml]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const docPath = path.join(root, 'docs/android.md');
const manifestPath = path.resolve(
  process.argv[2] ??
    path.join(
      root,
      'example/android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml'
    )
);

// Attributes that change what the app requests. Comparing them catches a
// lost maxSdkVersion or neverForLocation flag.
const COMPARED = [
  'android:maxSdkVersion',
  'android:usesPermissionFlags',
  'android:required',
];
// Entries the check covers; anything else (INTERNET, ...) belongs to the app.
const RELEVANT = /BLUETOOTH|LOCATION|android\.hardware\.bluetooth/;

/** Parses `<uses-permission>`, `<uses-permission-sdk-23>` and `<uses-feature>` elements. */
function parseEntries(xml) {
  const entries = new Map();
  const element = /<(uses-permission(?:-sdk-23)?|uses-feature)\b([^>]*?)\/?>/gs;
  for (const [, tag, body] of xml.matchAll(element)) {
    const attributes = Object.fromEntries(
      [...body.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map(([, key, value]) => [
        key,
        value,
      ])
    );
    const name = attributes['android:name'];
    if (name === undefined || !RELEVANT.test(name)) continue;
    const compared = Object.fromEntries(
      COMPARED.filter((key) => key in attributes).map((key) => [
        key,
        attributes[key],
      ])
    );
    entries.set(`${tag} ${name}`, compared);
  }
  return entries;
}

function documentedBlock() {
  const doc = readFileSync(docPath, 'utf8');
  const match = doc.match(
    /<!-- manifest-check:start -->([\s\S]*?)<!-- manifest-check:end -->/
  );
  if (match === null) {
    throw new Error(`${docPath} has no manifest-check block`);
  }
  return match[1];
}

if (!existsSync(manifestPath)) {
  console.error(
    `Merged manifest not found: ${manifestPath}\nBuild the example app for Android first.`
  );
  process.exit(1);
}

const documented = parseEntries(documentedBlock());
const merged = parseEntries(readFileSync(manifestPath, 'utf8'));
const problems = [];

for (const [key, attributes] of documented) {
  const actual = merged.get(key);
  if (actual === undefined) {
    problems.push(`missing: ${key}`);
  } else if (JSON.stringify(actual) !== JSON.stringify(attributes)) {
    problems.push(
      `${key}: expected ${JSON.stringify(attributes)}, merged ${JSON.stringify(actual)}`
    );
  }
}
for (const key of merged.keys()) {
  if (!documented.has(key)) problems.push(`not documented: ${key}`);
}

if (problems.length > 0) {
  console.error(
    `The merged manifest does not match docs/android.md:\n  ${problems.join('\n  ')}`
  );
  process.exit(1);
}
console.log(
  `Merged manifest matches docs/android.md (${documented.size} entries).`
);
