import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const sizes = [16, 48, 128];

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

function png(size) {
  const radius = size * 0.21;
  const center = size / 2;
  const raw = [];

  for (let y = 0; y < size; y += 1) {
    raw.push(0);
    for (let x = 0; x < size; x += 1) {
      const inset = size * 0.08;
      const corner = size * 0.2;
      const insideX = Math.max(inset - x, 0, x - (size - inset), 0);
      const insideY = Math.max(inset - y, 0, y - (size - inset), 0);
      const paperAlpha = Math.hypot(insideX, insideY) <= corner ? 255 : 0;
      const dotAlpha = Math.hypot(x - center, y - center) <= radius ? 255 : 0;
      if (dotAlpha) {
        raw.push(47, 107, 255, 255);
      } else {
        raw.push(250, 250, 247, paperAlpha);
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
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of sizes) {
  const file = resolve(`public/icons/${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size));
}
