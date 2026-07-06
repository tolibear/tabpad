// extension icons: an off-white rounded "paper" with the accent dot.
// rendered with 4x4 supersampling so edges are anti-aliased — hard on/off
// pixels read as jagged/low-res, especially at 16px and on the store page.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 48, 128];

const PAPER = [250, 250, 247];
const BORDER = [212, 212, 206];
const DOT = [47, 107, 255];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// signed distance to a rounded rectangle centered at (c, c)
function roundedRectDist(x, y, center, half, corner) {
  const qx = Math.abs(x - center) - (half - corner);
  const qy = Math.abs(y - center) - (half - corner);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - corner;
}

function png(size) {
  const center = size / 2;
  const half = size / 2 - size * 0.08;
  const corner = size * 0.2;
  const dotRadius = size * 0.21;
  const borderWidth = Math.max(size / 64, 0.75);
  const SS = 4; // 4x4 subsamples per pixel

  const raw = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(0);
    for (let x = 0; x < size; x += 1) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const rectDist = roundedRectDist(px, py, center, half, corner);
          if (rectDist > 0) continue; // outside the paper — transparent
          let color;
          if (Math.hypot(px - center, py - center) <= dotRadius) color = DOT;
          else if (rectDist > -borderWidth) color = BORDER;
          else color = PAPER;
          a += 1;
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      if (a === 0) {
        raw.push(0, 0, 0, 0);
      } else {
        raw.push(Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (SS * SS)) * 255));
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(raw), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of sizes) {
  const file = resolve(`public/icons/${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size));
}
