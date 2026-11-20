/**
 * A minimal zip writer for the export: stored (uncompressed) entries only, with
 * UTF-8 names and a fixed timestamp, so the same input always gives the same bytes.
 * Uses no Node-only APIs, so it runs in browsers too.
 */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 2026-11-20 00:00 as a DOS date and time. Any fixed value works; this one keeps output stable.
const dosTime = 0;
const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 20;
const utf8Flag = 0x0800;

/** Writes a zip of stored entries, in the order given. */
export function zipStored(entries: ReadonlyArray<readonly [name: string, content: string | Uint8Array]>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true); // Local file header.
    local.setUint16(4, 20, true); // Version needed: 2.0.
    local.setUint16(6, utf8Flag, true);
    local.setUint16(8, 0, true); // Method: stored.
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014B50, true); // Central directory header.
    header.setUint16(4, 20, true); // Version made by.
    header.setUint16(6, 20, true); // Version needed.
    header.setUint16(8, utf8Flag, true);
    header.setUint16(12, dosTime, true);
    header.setUint16(14, dosDate, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, data.length, true);
    header.setUint32(24, data.length, true);
    header.setUint16(28, nameBytes.length, true);
    header.setUint32(42, offset, true); // Where the local header starts.
    central.push(new Uint8Array(header.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true); // End of central directory.
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  chunks.push(...central, new Uint8Array(end.buffer));

  const out = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
