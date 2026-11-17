// Makes a WAV sound file smaller without changing what it is: still a WAV, under the same name, so nothing in the
// course has to change. It mixes the channels into one and lowers the sample rate (22,050 a second by default, as
// clear as a telephone call is not; speech stays clear, music loses its top). Plain PCM and floating-point WAVs are
// read; anything else is left as it is.

export interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** 1 is PCM, 3 is floating point. */
  format: number;
  /** Where the samples are in the file, and how many bytes. */
  dataOffset: number;
  dataLength: number;
}

function text(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}

/** What kind of WAV this is, or null when it is not one this can read. */
export function readWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44 || text(bytes, 0) !== "RIFF" || text(bytes, 8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let fmt: Omit<WavInfo, "dataOffset" | "dataLength"> | null = null;
  while (at + 8 <= bytes.length) {
    const id = text(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      let format = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format.
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true);
      fmt = { format, channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bitsPerSample: view.getUint16(body + 14, true) };
    } else if (id === "data" && fmt) {
      const length = Math.min(size, bytes.length - body);
      const ok = (fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bitsPerSample)) || (fmt.format === 3 && [32, 64].includes(fmt.bitsPerSample));
      return ok && fmt.channels > 0 && fmt.sampleRate > 0 ? { ...fmt, dataOffset: body, dataLength: length } : null;
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** The samples as numbers from -1 to 1, the channels mixed into one. */
function monoSamples(bytes: Uint8Array, w: WavInfo): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = w.bitsPerSample / 8;
  const frames = Math.floor(w.dataLength / (width * w.channels));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < w.channels; c++) {
      const at = w.dataOffset + (f * w.channels + c) * width;
      let v: number;
      if (w.format === 3) v = width === 4 ? view.getFloat32(at, true) : view.getFloat64(at, true);
      else if (width === 1) v = (bytes[at]! - 128) / 128;
      else if (width === 2) v = view.getInt16(at, true) / 32768;
      else if (width === 3) v = (((bytes[at + 2]! << 24) | (bytes[at + 1]! << 16) | (bytes[at]! << 8)) >> 8) / 8388608;
      else v = view.getInt32(at, true) / 2147483648;
      sum += v;
    }
    out[f] = sum / w.channels;
  }
  return out;
}

/** Lowers the sample rate: each new sample is the average of the old ones it covers, which also keeps out the hiss
 *  that dropping samples alone would add. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio;
    const end = start + ratio;
    let sum = 0;
    let weight = 0;
    for (let j = Math.floor(start); j < Math.ceil(end) && j < input.length; j++) {
      const w = Math.min(end, j + 1) - Math.max(start, j);
      sum += input[j]! * w;
      weight += w;
    }
    out[i] = weight ? sum / weight : 0;
  }
  return out;
}

function writeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const put = (at: number, s: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i); };
  put(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
  }
  return bytes;
}

/** A smaller WAV: one channel, 16-bit, at most `sampleRate` samples a second. Null when it cannot be read or is
 *  already that small. */
export function shrinkWav(bytes: Uint8Array, sampleRate = 22050): Uint8Array | null {
  const w = readWav(bytes);
  if (!w) return null;
  if (w.channels === 1 && w.sampleRate <= sampleRate && w.bitsPerSample <= 16 && w.format === 1) return null;
  const mono = monoSamples(bytes, w);
  return writeWav(resample(mono, w.sampleRate, Math.min(sampleRate, w.sampleRate)), Math.min(sampleRate, w.sampleRate));
}
