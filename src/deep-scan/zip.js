/*
 * Mochi — a tiny zip writer (STORE only: files are packed, not compressed).
 * Enough for the rebuild spec: text files and PNG screenshots (already
 * compressed). Pure JS, no libraries, nothing loaded from anywhere.
 *
 *   const bytes = Mochi.zip.build([{ name: 'PROMPT.md', data: 'text or Uint8Array' }, …])
 *   new Blob([bytes], { type: 'application/zip' })
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  let table = null;
  function crc32(bytes) {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  const utf8 = s => new TextEncoder().encode(s);
  /** MS-DOS time and date fields. */
  function dosTime(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
    };
  }

  /** files: [{ name, data: string | Uint8Array | ArrayBuffer }] → Uint8Array (a .zip). */
  function build(files, { date = new Date() } = {}) {
    const { time, date: day } = dosTime(date);
    const parts = [];
    const central = [];
    let offset = 0;
    const seen = new Set();
    for (const f of files) {
      let name = String(f.name).replace(/^\/+/, '').replace(/\\/g, '/');
      if (seen.has(name)) continue; // first one wins
      seen.add(name);
      const nameBytes = utf8(name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // STORE
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); // central directory header
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, time, true);
      c.setUint16(14, day, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, nameBytes.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory
    end.setUint16(8, seen.size, true);
    end.setUint16(10, seen.size, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of all) { out.set(b, at); at += b.length; }
    return out;
  }

  /** Reads a STORE zip back (tests, and checking our own output): → [{ name, data }]. */
  function read(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let e = bytes.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a zip');
    const count = v.getUint16(e + 10, true);
    let p = v.getUint32(e + 16, true);
    const out = [];
    for (let i = 0; i < count; i++) {
      const size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = v.getUint16(local + 26, true), lExtra = v.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtra;
      out.push({ name, data: bytes.subarray(start, start + size), crc: v.getUint32(p + 16, true) });
      p += 46 + nameLen + extra + comment;
    }
    return out;
  }

  Mochi.zip = { build, read, crc32 };
  if (typeof module !== 'undefined') module.exports = Mochi.zip;
})();
