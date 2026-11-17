// Animated PNG (APNG) from same-size PNG frames.
//
// The animated bot faces used to step through a sprite sheet with a CSS
// keyframe animation on background-position. Chrome cannot run that on the
// compositor, so a page with one working bot recalculated style and painted
// 60 times a second, though the face changes only every ~200 ms. Chrome
// animates an animated image off the main thread, redrawing only on its frame
// changes, so the faces now use one (see botArt.js, content.css). The frames
// and their timing are the sprite sheet's.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The chunks of one PNG file: [{ type, data }]. Null when it is not a PNG. */
export function pngChunks(bytes) {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (at + 12 + length > bytes.length) return null;
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function fields(size, write) {
  const data = new Uint8Array(size);
  write(new DataView(data.buffer));
  return data;
}

/**
 * One looping APNG from `frames` (PNG files as bytes, all the same size and
 * format), each shown for `frameMs`. Null when the frames do not fit together.
 */
export function assembleApng(frames, frameMs) {
  const parsed = frames.map(pngChunks);
  if (!parsed.length || parsed.some((c) => !c || c[0]?.type !== "IHDR")) return null;
  const ihdr = parsed[0][0].data;
  if (parsed.some((c) => c[0].data.length !== ihdr.length || c[0].data.some((b, i) => b !== ihdr[i]))) return null;
  const width = new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(0);
  const height = new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(4);
  const delay = Math.round(frameMs);
  if (!(delay > 0 && delay < 65536)) return null;
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr)];
  // Plays forever (num_plays 0).
  parts.push(chunk("acTL", fields(8, (v) => v.setUint32(0, frames.length))));
  let sequence = 0;
  parsed.forEach((chunks, index) => {
    // Whole frame at 0,0, shown for delay/1000 s, replacing the previous one (dispose none, blend source).
    parts.push(chunk("fcTL", fields(26, (v) => {
      v.setUint32(0, sequence++);
      v.setUint32(4, width);
      v.setUint32(8, height);
      v.setUint16(20, delay);
      v.setUint16(22, 1000);
    })));
    for (const { type, data } of chunks) {
      if (type !== "IDAT") continue;
      if (index === 0) parts.push(chunk("IDAT", data));
      else {
        const fdat = new Uint8Array(4 + data.length);
        new DataView(fdat.buffer).setUint32(0, sequence++);
        fdat.set(data, 4);
        parts.push(chunk("fdAT", fdat));
      }
    }
  });
  parts.push(chunk("IEND", new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
