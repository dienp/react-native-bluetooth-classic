/* eslint-disable no-bitwise -- byte-level encoding */
import { invalidArgument } from '../validation';

const HEX = '0123456789abcdef';

/** Encodes bytes as lower-case hex without separators. */
export function toHex(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    output += HEX[byte >> 4]! + HEX[byte & 15]!;
  }
  return output;
}

/**
 * Decodes hex. Whitespace and `:` / `-` separators are ignored, case does not
 * matter. Throws `INVALID_ARGUMENT` on odd length or other characters.
 */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/[\s:-]+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw invalidArgument(
      `Invalid hex string ${JSON.stringify(text)}: expected pairs of hex digits`
    );
  }
  const output = new Uint8Array(clean.length / 2);
  for (let i = 0; i < output.length; i++) {
    output[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return output;
}
