import type * as Real from '../index';
import * as Mocked from '../jest';
import * as RealValues from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// Compile-time: the mock exports exactly the real API, with identical types,
// plus `mock`. `yarn typecheck` fails if they ever drift apart.
export const sameApi: Equal<typeof Real, Omit<typeof Mocked, 'mock'>> = true;
export const sameConnection: Equal<Real.Connection, Mocked.Connection> = true;
export const sameOptions: Equal<Real.ConnectOptions, Mocked.ConnectOptions> =
  true;

test('the mock entry exports every value of the real entry, the same objects, plus mock', () => {
  const real = Object.keys(RealValues).sort();
  const mocked = Object.keys(Mocked)
    .filter((key) => key !== 'mock')
    .sort();

  expect(mocked).toEqual(real);
  for (const key of real) {
    expect(Mocked[key as keyof typeof Mocked]).toBe(
      RealValues[key as keyof typeof RealValues]
    );
  }
});
