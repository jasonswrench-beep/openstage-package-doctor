// Reads a zip's table of contents (the central directory) without unpacking anything, and unpacks single files on
// request. Package Doctor reads the table itself, rather than handing the whole zip to an unzip library, for two
// reasons: a big package (a long video) is never unpacked in memory just to list it, and the flags that make an LMS
// refuse a zip (encryption, an unusual compression method, backslashes in names, names that are not UTF-8) are in
// the table and would be lost. fflate (MIT) does the inflating.

import { inflateSync } from "fflate";

export interface ZipEntry {
  /** The name as an LMS would see it after unpacking, with backslashes turned into slashes. */
  path: string;
  /** The name exactly as it is stored in the zip. */
  rawName: string;
  /** Unpacked size in bytes. */
  size: number;
  /** Size inside the zip in bytes. */
  packedSize: number;
  /** 0 is stored, 8 is deflate; anything else most LMSs cannot unpack. */
  method: number;
  encrypted: boolean;
  /** The zip marks the name as UTF-8 (flag bit 11), or carries a UTF-8 copy of it. */
  utf8Name: boolean;
  /** The stored name has bytes outside plain ASCII. */
  nonAsciiName: boolean;
  isDirectory: boolean;
  crc32: number;
  localHeaderOffset: number;
}

export class ZipError extends Error {
  readonly code: "not-a-zip" | "damaged" | "multi-disk";
  constructor(code: ZipError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ZipError";
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// Code page 437, the old DOS character set the zip format assumes when a name is not marked UTF-8 (bytes 128 to 255).
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeCp437(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437_HIGH[b - 128];
  return s;
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes: Uint8Array, markedUtf8: boolean): string {
  if (markedUtf8) return new TextDecoder("utf-8").decode(bytes);
  // Many zip makers write UTF-8 without setting the flag. A name that is valid UTF-8 is almost always meant as UTF-8.
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return decodeCp437(bytes);
  }
}

let crcTable: Uint32Array | undefined;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export class ZipArchive {
  readonly entries: ZipEntry[];
  readonly byteLength: number;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.byteLength = bytes.length;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.entries = this.readCentralDirectory();
  }

  private u16(at: number): number {
    return this.view.getUint16(at, true);
  }
  private u32(at: number): number {
    return this.view.getUint32(at, true);
  }
  private u64(at: number): number {
    const value = this.view.getBigUint64(at, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError("damaged", "A size in the zip is too large to be real.");
    return Number(value);
  }

  private findEndRecord(): number {
    const len = this.bytes.length;
    if (len < 22) throw new ZipError("not-a-zip", "The file is too small to be a zip.");
    const stop = Math.max(0, len - 22 - 0xffff);
    for (let at = len - 22; at >= stop; at--) {
      if (this.u32(at) === SIG_EOCD) return at;
    }
    if (this.u32(0) === SIG_LOCAL) {
      throw new ZipError("damaged", "The zip's table of contents is missing. The file may not have finished downloading or copying.");
    }
    throw new ZipError("not-a-zip", "This file is not a zip.");
  }

  private readCentralDirectory(): ZipEntry[] {
    const eocd = this.findEndRecord();
    const disk = this.u16(eocd + 4);
    const cdDisk = this.u16(eocd + 6);
    let count = this.u16(eocd + 10);
    let cdSize = this.u32(eocd + 12);
    let cdOffset = this.u32(eocd + 16);
    if (disk !== 0 || cdDisk !== 0) {
      if (disk !== 0xffff && cdDisk !== 0xffff) throw new ZipError("multi-disk", "This zip is split across several files.");
    }
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locator = eocd - 20;
      if (locator >= 0 && this.u32(locator) === SIG_ZIP64_LOCATOR) {
        const z64 = this.u64(locator + 8);
        if (z64 + 56 > this.bytes.length || this.u32(z64) !== SIG_ZIP64_EOCD) {
          throw new ZipError("damaged", "The zip's large-file table of contents is damaged.");
        }
        count = this.u64(z64 + 32);
        cdSize = this.u64(z64 + 40);
        cdOffset = this.u64(z64 + 48);
      }
    }
    if (cdOffset + cdSize > this.bytes.length) {
      throw new ZipError("damaged", "The zip's table of contents points past the end of the file. The file may be cut short.");
    }

    const entries: ZipEntry[] = [];
    let at = cdOffset;
    for (let i = 0; i < count; i++) {
      if (at + 46 > this.bytes.length || this.u32(at) !== SIG_CENTRAL) {
        throw new ZipError("damaged", `The zip's table of contents is damaged at entry ${i + 1} of ${count}.`);
      }
      const flags = this.u16(at + 8);
      const method = this.u16(at + 10);
      const crc = this.u32(at + 16);
      let packedSize = this.u32(at + 20);
      let size = this.u32(at + 24);
      const nameLen = this.u16(at + 28);
      const extraLen = this.u16(at + 30);
      const commentLen = this.u16(at + 32);
      let localHeaderOffset = this.u32(at + 42);
      const nameBytes = this.bytes.subarray(at + 46, at + 46 + nameLen);
      let utf8Name = (flags & 0x0800) !== 0;
      let rawName = decodeName(nameBytes, utf8Name);

      // Extra fields: zip64 sizes (0x0001) and a UTF-8 copy of the name (0x7075).
      let ex = at + 46 + nameLen;
      const exEnd = ex + extraLen;
      while (ex + 4 <= exEnd) {
        const id = this.u16(ex);
        const len = this.u16(ex + 2);
        const body = ex + 4;
        if (id === 0x0001) {
          let p = body;
          if (size === 0xffffffff && p + 8 <= body + len) { size = this.u64(p); p += 8; }
          if (packedSize === 0xffffffff && p + 8 <= body + len) { packedSize = this.u64(p); p += 8; }
          if (localHeaderOffset === 0xffffffff && p + 8 <= body + len) { localHeaderOffset = this.u64(p); p += 8; }
        } else if (id === 0x7075 && len > 5) {
          rawName = new TextDecoder("utf-8").decode(this.bytes.subarray(body + 5, body + len));
          utf8Name = true;
        }
        ex = body + len;
      }

      const nonAsciiName = nameBytes.some((b) => b > 0x7f);
      const isDirectory = rawName.endsWith("/") || rawName.endsWith("\\");
      entries.push({
        path: rawName.replace(/\\/g, "/"),
        rawName,
        size,
        packedSize,
        method,
        encrypted: (flags & 0x0001) !== 0,
        utf8Name,
        nonAsciiName,
        isDirectory,
        crc32: crc,
        localHeaderOffset,
      });
      at += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /** Unpacks one entry. Throws a ZipError if it is encrypted, uses a method other than stored or deflate, or is damaged. */
  read(entry: ZipEntry): Uint8Array {
    if (entry.encrypted) throw new ZipError("damaged", `${entry.path} is password-protected.`);
    const at = entry.localHeaderOffset;
    if (at + 30 > this.bytes.length || this.u32(at) !== SIG_LOCAL) {
      throw new ZipError("damaged", `${entry.path} could not be found inside the zip where its table of contents says it is.`);
    }
    const start = at + 30 + this.u16(at + 26) + this.u16(at + 28);
    const end = start + entry.packedSize;
    if (end > this.bytes.length) throw new ZipError("damaged", `${entry.path} is cut short.`);
    const packed = this.bytes.subarray(start, end);
    let out: Uint8Array;
    if (entry.method === 0) out = packed;
    else if (entry.method === 8) {
      try {
        out = inflateSync(packed, { out: new Uint8Array(entry.size) });
      } catch {
        throw new ZipError("damaged", `${entry.path} could not be unpacked.`);
      }
    } else throw new ZipError("damaged", `${entry.path} uses a compression method (${entry.method}) that cannot be unpacked here.`);
    if (out.length !== entry.size || crc32(out) !== entry.crc32) {
      throw new ZipError("damaged", `${entry.path} is damaged: what comes out does not match the zip's own checksum.`);
    }
    return out;
  }
}
