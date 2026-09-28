// Compact MD5 (public domain, after Joseph Myers) — used to build Wikimedia Commons image paths.
const add = (x: number, y: number) => {
  const l = (x & 0xffff) + (y & 0xffff);
  return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff);
};
const rol = (n: number, c: number) => (n << c) | (n >>> (32 - c));
const cmn = (q: number, a: number, b: number, x: number, s: number, t: number) => add(rol(add(add(a, q), add(x, t)), s), b);
const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & c) | (~b & d), a, b, x, s, t);
const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & d) | (c & ~d), a, b, x, s, t);
const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(b ^ c ^ d, a, b, x, s, t);
const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(c ^ (b | ~d), a, b, x, s, t);

// Per-round shift amounts and sine-derived constants.
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => (Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0));
const IDX = (i: number) => (i < 16 ? i : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16);
const FNS = [ff, gg, hh, ii];

function core(x: number[], len: number): number[] {
  x[len >> 5] |= 0x80 << len % 32;
  x[(((len + 64) >>> 9) << 4) + 14] = len;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    for (let j = 0; j < 64; j++) {
      const r = j >> 4;
      const f = FNS[r](a, b, c, d, x[i + IDX(j)] | 0, S[r * 4 + (j % 4)], K[j]);
      a = d; d = c; c = b; b = f;
    }
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  return [a, b, c, d];
}

export function md5(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  const h = core(words, bytes.length * 8);
  let out = "";
  for (let i = 0; i < 16; i++) out += ((h[i >> 2] >>> ((i % 4) * 8)) & 0xff).toString(16).padStart(2, "0");
  return out;
}
