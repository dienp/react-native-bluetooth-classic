/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

/** The code block between `<!-- name:start -->` and `<!-- name:end -->`. */
function sample(doc: string, name: string): string {
  const text = readFileSync(path.join(root, doc), 'utf8');
  const match = text.match(
    new RegExp(
      `<!-- ${name}:start -->\\s*\`\`\`\\w*\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- ${name}:end -->`
    )
  );
  if (match === null) throw new Error(`${doc} has no ${name} block`);
  return match[1]!;
}

test('the sample in docs/testing.md is the test CI runs', () => {
  const runs = readFileSync(
    path.join(root, 'example/src/__tests__/testing-sample.test.ts'),
    'utf8'
  );

  expect(sample('docs/testing.md', 'testing-sample')).toBe(runs.trimEnd());
});
