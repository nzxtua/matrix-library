/**
 * FNV-1a, 32 bit, over the UTF-16 code units of `text`. Returned in base36.
 *
 * It names things (block ids, section hashes). The same text gives the same
 * name in every browser and every build. It is not a security hash.
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
