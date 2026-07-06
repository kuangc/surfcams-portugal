import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ICONS = [
  { path: "icons/icon-192.png", size: 192 },
  { path: "icons/icon-512.png", size: 512 },
  { path: "apple-touch-icon.png", size: 180 }
];

const COLORS = {
  teal: [8, 117, 111, 255],
  tealDark: [6, 89, 85, 255],
  gold: [200, 145, 30, 255],
  foam: [255, 255, 255, 255]
};

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function writePng(filename, size, pixels) {
  const scanlines = Buffer.alloc((size * 4 + 1) * size);

  for (let y = 0; y < size; y += 1) {
    const scanlineOffset = y * (size * 4 + 1);
    scanlines[scanlineOffset] = 0;
    pixels.copy(scanlines, scanlineOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND")
  ]));
}

function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const vignette = Math.max(Math.abs(nx - 0.5), Math.abs(ny - 0.5));
      const base = vignette > 0.43 ? COLORS.tealDark : COLORS.teal;
      const goldWave = 0.43 + Math.sin((nx * 2.2 + 0.1) * Math.PI * 2) * 0.035;
      const foamWave = 0.62 + Math.sin((nx * 1.7 + 0.24) * Math.PI * 2) * 0.045;
      let color = base;

      if (ny >= goldWave && ny < foamWave + 0.01 && nx > 0.11 && nx < 0.9) {
        color = COLORS.gold;
      }
      if (ny >= foamWave && nx > 0.08 && nx < 0.92) {
        color = COLORS.foam;
      }

      setPixel(pixels, size, x, y, color);
    }
  }

  return pixels;
}

for (const icon of ICONS) {
  writePng(icon.path, icon.size, renderIcon(icon.size));
}
