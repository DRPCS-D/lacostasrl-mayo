/**
 * Generador de íconos PWA sin dependencias externas (no hay sharp/imagemagick
 * disponibles en este entorno). Dibuja un cuadrado redondeado color marca con
 * el mismo ícono "caja" que usa la pantalla de carga/login de la app, y lo
 * codifica como PNG a mano (zlib de Node + chunks PNG manuales).
 *
 * Uso: node scripts/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PRIMARY = [0x8a, 0x1b, 0x1a]; // #8A1B1A
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let cc = n;
      for (let k = 0; k < 8; k++) cc = cc & 1 ? (0xedb88320 ^ (cc >>> 1)) : (cc >>> 1);
      t[n] = cc >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function roundedRectMask(x, y, w, h, r, px, py) {
  // true si (px,py) cae dentro del rectángulo redondeado
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r || (px >= x && px <= x + w && py >= y && py <= y + h && !(
    (px < x + r || px > x + w - r) && (py < y + r || py > y + h - r)
  ));
}

function drawIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bgR = maskable ? 0 : Math.round(size * 0.08); // maskable: sin esquinas redondeadas, el sistema recorta
  // padding del contenido: maskable necesita más margen (safe zone ~80% central)
  const contentScale = maskable ? 0.5 : 0.62;
  const boxSize = size * contentScale;
  const boxX = (size - boxSize) / 2;
  const boxY = (size - boxSize) / 2;
  const strokeW = Math.max(2, Math.round(size * 0.045));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let color = null;
      const inBg = roundedRectMask(0, 0, size, size, bgR, x, y);
      if (inBg) color = PRIMARY;

      // ícono: rect redondeado (outline) + línea horizontal + línea vertical, blanco
      const rx = size * 0.1;
      const onBoxBorder =
        roundedRectMask(boxX, boxY, boxSize, boxSize, rx, x, y) &&
        !roundedRectMask(boxX + strokeW, boxY + strokeW, boxSize - 2 * strokeW, boxSize - 2 * strokeW, Math.max(0, rx - strokeW), x, y);
      const midY = boxY + boxSize * 0.33;
      const onHLine = onInBox(boxX, boxY, boxSize, x, y) && Math.abs(y - midY) <= strokeW / 2;
      const midX = boxX + boxSize * 0.5;
      const onVLine = onInBox(boxX, boxY, boxSize, x, y) && y >= midY && Math.abs(x - midX) <= strokeW / 2;

      function onInBox(bx, by, bs, px, py) {
        return px >= bx && px <= bx + bs && py >= by && py <= by + bs;
      }

      if (onBoxBorder || onHLine || onVLine) color = WHITE;

      if (color) {
        buf[idx] = color[0]; buf[idx + 1] = color[1]; buf[idx + 2] = color[2]; buf[idx + 3] = 255;
      } else {
        buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
      }
    }
  }
  return buf;
}

const OUT = path.join(__dirname, '..', 'web', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
];

targets.forEach(t => {
  const rgba = drawIcon(t.size, { maskable: t.maskable });
  const png = encodePng(t.size, t.size, rgba);
  fs.writeFileSync(path.join(OUT, t.name), png);
  console.log('Generado', t.name, '(' + png.length + ' bytes)');
});
