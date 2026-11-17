// Writes a new package from an open one, with some files replaced. It never touches the zip that was opened: the
// result is a new zip in memory, which the window saves under a new name.
//
// Files that are not replaced are copied exactly as they are stored, still packed, so nothing about them changes
// (their names, dates, packing and checksums). A replaced file is packed again: deflated if that makes it smaller,
// stored if it is a picture, sound or video that is packed already. On request, text files (pages, scripts, style
// sheets, data) and fonts are packed again more tightly, which loses nothing.

import { deflateSync } from "fflate";
import { crc32, type ZipArchive, type ZipEntry } from "./zip.ts";

/** Kinds of file that are already packed: deflating them again gains nothing, so they are stored. */
const ALREADY_PACKED = /\.(jpe?g|png|gif|webp|avif|mp3|m4a|aac|ogg|oga|opus|mp4|m4v|webm|ogv|mov|zip|woff2|swf|pdf|docx|xlsx|pptx|gz)$/i;
/** Kinds of file that deflate well and are worth packing again. */
export const REPACKABLE = /\.(html?|xhtml?|m?js|css|json|xml|xsd|dtd|svg|txt|vtt|srt|csv|md|ttf|otf|eot|wav)$/i;

export interface RepackResult {
  path: string;
  /** Bytes it took in the zip before and after. */
  before: number;
  after: number;
}

export interface WrittenPackage {
  bytes: Uint8Array;
  /** Files packed again more tightly, when repackText was asked for. */
  repacked: RepackResult[];
}

const enc = new TextEncoder();

/** The time now in the zip's MS-DOS form. */
function dosNow(): { time: number; date: number } {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Out {
  entry: ZipEntry;
  name: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  size: number;
  data: Uint8Array;
  time: number;
  date: number;
}

/** Packs data the best way: deflated when that is smaller, otherwise stored. */
function pack(path: string, data: Uint8Array): { method: number; data: Uint8Array } {
  if (ALREADY_PACKED.test(path) || data.length === 0) return { method: 0, data };
  const deflated = deflateSync(data, { level: 9 });
  return deflated.length < data.length ? { method: 8, data: deflated } : { method: 0, data };
}

/**
 * A new zip: the open package with `replace`'s files in place of its own (same path, new content). The files keep their
 * order. `repackText` packs text files and fonts again as tightly as deflate can.
 */
export function writePackage(archive: ZipArchive, replace: ReadonlyMap<string, Uint8Array>, options: { repackText?: boolean } = {}): WrittenPackage {
  const now = dosNow();
  const out: Out[] = [];
  const repacked: RepackResult[] = [];
  for (const entry of archive.entries) {
    const nonAscii = /[^\x00-\x7f]/.test(entry.rawName);
    const name = enc.encode(entry.rawName);
    const nameFlag = nonAscii ? 0x0800 : 0;
    const replacement = entry.isDirectory ? undefined : replace.get(entry.path);
    if (replacement) {
      const packed = pack(entry.path, replacement);
      out.push({ entry, name, flags: nameFlag, method: packed.method, crc: crc32(replacement), size: replacement.length, data: packed.data, time: now.time, date: now.date });
      continue;
    }
    if (options.repackText && !entry.isDirectory && !entry.encrypted && (entry.method === 0 || entry.method === 8) && REPACKABLE.test(entry.path) && entry.size > 0) {
      const data = archive.read(entry);
      const deflated = deflateSync(data, { level: 9 });
      if (deflated.length < entry.packedSize) {
        repacked.push({ path: entry.path, before: entry.packedSize, after: deflated.length });
        out.push({ entry, name, flags: nameFlag, method: 8, crc: entry.crc32, size: entry.size, data: deflated, time: entry.dosTime, date: entry.dosDate });
        continue;
      }
    }
    // Copied as it is stored. Bit 3 (sizes after the data) is dropped: this zip writes the sizes in the header.
    out.push({ entry, name, flags: (entry.encrypted ? 1 : 0) | nameFlag, method: entry.method, crc: entry.crc32, size: entry.size, data: archive.packed(entry), time: entry.dosTime, date: entry.dosDate });
  }

  let total = 22;
  for (const o of out) total += 30 + o.name.length + o.data.length + 46 + o.name.length;
  if (total > 0xffffffff || out.length > 0xffff) throw new Error("The new package would be larger than 4 GB or hold more than 65,535 files, which this version cannot write.");

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const o of out) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, o.method === 8 ? 20 : 10, true);
    view.setUint16(at + 6, o.flags, true);
    view.setUint16(at + 8, o.method, true);
    view.setUint16(at + 10, o.time, true);
    view.setUint16(at + 12, o.date, true);
    view.setUint32(at + 14, o.crc, true);
    view.setUint32(at + 18, o.data.length, true);
    view.setUint32(at + 22, o.size, true);
    view.setUint16(at + 26, o.name.length, true);
    view.setUint16(at + 28, 0, true);
    bytes.set(o.name, at + 30);
    bytes.set(o.data, at + 30 + o.name.length);
    at += 30 + o.name.length + o.data.length;
  }
  const cdStart = at;
  out.forEach((o, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 0x0314, true); // made by: version 2.0, Unix, so the attributes below are read as permissions
    view.setUint16(at + 6, o.method === 8 ? 20 : 10, true);
    view.setUint16(at + 8, o.flags, true);
    view.setUint16(at + 10, o.method, true);
    view.setUint16(at + 12, o.time, true);
    view.setUint16(at + 14, o.date, true);
    view.setUint32(at + 16, o.crc, true);
    view.setUint32(at + 20, o.data.length, true);
    view.setUint32(at + 24, o.size, true);
    view.setUint16(at + 28, o.name.length, true);
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    // Ordinary read and write permissions (rw-r--r--, or rwxr-xr-x for a folder), so a server unpacks files it can serve.
    view.setUint32(at + 38, (o.entry.isDirectory ? 0o40755 : 0o100644) * 0x10000 + (o.entry.isDirectory ? 0x10 : 0), true);
    view.setUint32(at + 42, offsets[i]!, true);
    bytes.set(o.name, at + 46);
    at += 46 + o.name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, out.length, true);
  view.setUint16(at + 10, out.length, true);
  view.setUint32(at + 12, at - cdStart, true);
  view.setUint32(at + 16, cdStart, true);
  return { bytes, repacked };
}
