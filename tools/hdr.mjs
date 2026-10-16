// A small reader for Radiance .hdr files (RGBE, flat or run-length encoded
// scanlines), enough for Poly Haven's panoramas. Returns linear RGB floats.
export function readHDR(buf) {
  let pos = 0;
  const line = () => { let s = ''; while (pos < buf.length && buf[pos] !== 10) s += String.fromCharCode(buf[pos++]); pos++; return s; };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR file');
  for (let l = line(); l !== ''; l = line()) if (l.startsWith('FORMAT=') && !l.includes('32-bit_rle_rgbe')) throw new Error('unsupported ' + l);
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  if (!m) throw new Error('unsupported orientation');
  const height = +m[1], width = +m[2], data = new Float32Array(width * height * 3), scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 32768 && buf[pos] === 2 && buf[pos + 1] === 2 && !(buf[pos + 2] & 0x80)) {
      pos += 4; // new-style RLE: each of the four channels in turn
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width;) {
          let n = buf[pos++];
          if (n > 128) { n -= 128; const v = buf[pos++]; while (n--) scan[(x++) * 4 + c] = v; }
          else while (n--) scan[(x++) * 4 + c] = buf[pos++];
        }
      }
    } else { scan.set(buf.subarray(pos, pos + width * 4)); pos += width * 4; }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3], o = (y * width + x) * 3;
      if (!e) continue;
      const f = Math.pow(2, e - 136);
      data[o] = scan[x * 4] * f; data[o + 1] = scan[x * 4 + 1] * f; data[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { width, height, data };
}
