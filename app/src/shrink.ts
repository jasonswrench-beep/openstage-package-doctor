// Makes pictures and videos smaller with what the window itself can do: it decodes and encodes them with the browser's
// own picture and video codecs (WebCodecs, which on Windows use Windows' own H.264 encoder). Nothing is uploaded and no
// separate program is needed. core/src/media/shrink.ts decides which files to try; this does the work.
//
// A file keeps its name and its format: a JPEG stays a JPEG and an MP4 stays an H.264 MP4, so nothing in the course
// that points at it has to change. A video's sound is copied across as it is, never encoded again and never dropped.
// mp4box.js (BSD-3-Clause) reads the MP4 and mp4-muxer (MIT) writes the new one; see NOTICE.

import { createFile, DataStream, Endianness, MP4BoxBuffer, type ISOFile, type Movie, type Sample, type Track } from "mp4box";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { ShrinkOptions } from "../../core/src/media/shrink.ts";

export interface Shrunk {
  /** The smaller file, or null when it could not be made (the note says why). */
  data: Uint8Array | null;
  note: string;
}

const PICTURE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** A photograph saved again at the chosen quality, and made smaller if it is wider or taller than the limit. */
export async function shrinkPicture(path: string, bytes: Uint8Array, options: ShrinkOptions): Promise<Shrunk> {
  const type = PICTURE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (!type) return { data: null, note: "Not a kind of picture this makes smaller." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  } catch {
    return { data: null, note: "The picture could not be read." };
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, options.maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type, quality: options.quality });
  if (blob.type !== type) return { data: null, note: `This window cannot save ${type.replace("image/", "").toUpperCase()} pictures.` };
  const quality = Math.round(options.quality * 100);
  const note = scale < 1 ? `${width} by ${height} pixels made ${w} by ${h}, saved at quality ${quality}.` : `Saved at quality ${quality}, the same size (${width} by ${height} pixels).`;
  return { data: new Uint8Array(await blob.arrayBuffer()), note };
}

// ---- video

/** Reads an MP4, and collects the samples of its first video and first sound track. The samples are asked for as soon
 *  as the tracks are known, before the rest of the file is read, so the pieces of a fragmented MP4 (as a browser or a
 *  screen recorder writes) are collected as well as one in a single block. */
function readMovie(bytes: Uint8Array): { file: ISOFile; info: Movie; samples: Map<number, Sample[]> } {
  const file = createFile();
  let info: Movie | undefined;
  let error = "";
  const samples = new Map<number, Sample[]>();
  file.onError = (_module: string, message: string) => (error = message);
  file.onSamples = (id: number, _user: unknown, list: Sample[]) => samples.get(id)?.push(...list);
  file.onReady = (i: Movie) => {
    info = i;
    for (const t of [i.videoTracks[0], i.audioTracks[0]]) {
      if (!t) continue;
      samples.set(t.id, []);
      file.setExtractionOptions(t.id, null, { nbSamples: 1000 });
    }
    file.start();
  };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.slice().buffer, 0));
  file.flush();
  if (!info) throw new Error(error ? `The video could not be read: ${error}.` : "The video could not be read as an MP4.");
  return { file, info, samples };
}

/** The codec's own setup bytes (avcC for H.264 and so on), which a decoder needs before the first picture. */
function videoDescription(file: ISOFile, track: Track): Uint8Array | undefined {
  const trak = file.getTrackById(track.id);
  for (const entry of trak.mdia.minf.stbl.stsd.entries as unknown as Record<string, { write(s: DataStream): void } | undefined>[]) {
    const box = entry["avcC"] ?? entry["hvcC"] ?? entry["vpcC"] ?? entry["av1C"];
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer as ArrayBuffer, 8); // without the box's own 8-byte header
    }
  }
  return undefined;
}

/** AAC's AudioSpecificConfig, which an MP4 must carry for its sound to play. */
function audioDescription(file: ISOFile, track: Track): Uint8Array | undefined {
  const trak = file.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0] as unknown as { esds?: { esd?: { descs?: { descs?: { data?: Uint8Array }[] }[] } } };
  const data = entry.esds?.esd?.descs?.[0]?.descs?.[0]?.data;
  return data ? new Uint8Array(data) : undefined;
}

/** The turn the MP4 asks players to give the picture, from its matrix: 0, 90, 180 or 270. */
function rotation(track: Track): 0 | 90 | 180 | 270 {
  const m = Array.from(track.matrix as ArrayLike<number>);
  const [a, b] = [m[0] ?? 65536, m[1] ?? 0];
  if (a === 0 && b > 0) return 90;
  if (a < 0 && b === 0) return 180;
  if (a === 0 && b < 0) return 270;
  return 0;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An MP4 video encoded again as H.264, no taller than the limit, at the chosen bit rate. Its sound is copied as it is. */
export async function shrinkVideo(bytes: Uint8Array, options: ShrinkOptions, progress: (fraction: number) => void = () => {}, cancelled: () => boolean = () => false): Promise<Shrunk> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return { data: null, note: "This window cannot encode video." };
  const { file, info, samples } = readMovie(bytes);
  const video = info.videoTracks[0];
  if (!video) return { data: null, note: "It has no video in it." };
  if (info.videoTracks.length > 1) return { data: null, note: "It has more than one video track, which this does not change." };
  const audio = info.audioTracks[0];
  if (info.audioTracks.length > 1) return { data: null, note: "It has more than one sound track, which this does not change." };
  if (audio && !audio.codec.startsWith("mp4a")) return { data: null, note: `Its sound is ${audio.codec}, which this cannot copy into the new file.` };

  const width = video.video?.width ?? video.track_width;
  const height = video.video?.height ?? video.track_height;
  const h = even(Math.min(options.videoHeight, height));
  const w = even((width * h) / height);
  const seconds = video.duration / video.timescale;
  const oldBitrate = video.bitrate || (bytes.length * 8) / Math.max(seconds, 0.1);
  if (h >= height && oldBitrate <= options.videoBitrate * 1.1) return { data: null, note: "It is already this small." };
  const bitrate = Math.min(options.videoBitrate, Math.round(oldBitrate * 0.8));
  const fps = video.nb_samples / Math.max(seconds, 0.1);

  const decoderConfig: VideoDecoderConfig = { codec: video.codec, codedWidth: width, codedHeight: height, description: videoDescription(file, video) };
  if (!(await VideoDecoder.isConfigSupported(decoderConfig)).supported) return { data: null, note: `This window cannot read its video (${video.codec}).` };
  let encoderConfig: VideoEncoderConfig | undefined;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a"]) {
    const c: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: Math.round(fps) || 30, avc: { format: "avc" }, latencyMode: "quality" };
    if ((await VideoEncoder.isConfigSupported(c)).supported) { encoderConfig = c; break; }
  }
  if (!encoderConfig) return { data: null, note: "This window cannot encode H.264 video." };

  const frames = samples.get(video.id) ?? [];
  if (!frames.length) return { data: null, note: "No pictures could be read from its video." };
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: w, height: h, rotation: rotation(video) },
    audio: audio ? { codec: "aac", numberOfChannels: audio.audio?.channel_count ?? 2, sampleRate: audio.audio?.sample_rate ?? 44100 } : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let failure: Error | undefined;
  let encoded = 0;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      encoded++;
      progress(encoded / Math.max(1, frames.length));
    },
    error: (e) => (failure ??= e),
  });
  encoder.configure(encoderConfig);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  let n = 0;
  const keyEvery = Math.max(1, Math.round((fps || 30) * 2));
  const decoder = new VideoDecoder({
    output: (frame) => {
      ctx.drawImage(frame, 0, 0, w, h);
      const scaled = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
      frame.close();
      encoder.encode(scaled, { keyFrame: n++ % keyEvery === 0 });
      scaled.close();
    },
    error: (e) => (failure ??= e),
  });
  decoder.configure(decoderConfig);

  for (const s of frames) {
    if (failure) break;
    if (cancelled()) {
      decoder.close();
      encoder.close();
      return { data: null, note: "Stopped before it was finished." };
    }
    while (decoder.decodeQueueSize > 8 || encoder.encodeQueueSize > 8) await wait();
    decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? "key" : "delta", timestamp: (s.cts * 1e6) / s.timescale, duration: (s.duration * 1e6) / s.timescale, data: s.data! }));
  }
  if (!failure) {
    try {
      await decoder.flush();
      await encoder.flush();
    } catch (e) {
      failure ??= e as Error;
    }
  }
  if (decoder.state !== "closed") decoder.close();
  if (encoder.state !== "closed") encoder.close();
  if (failure) return { data: null, note: `The video could not be encoded again: ${failure.message}` };
  if (encoded === 0) return { data: null, note: `None of its ${frames.length} pictures could be decoded.` };

  if (audio) {
    const description = audioDescription(file, audio);
    let first = true;
    for (const s of samples.get(audio.id) ?? []) {
      const meta = first ? { decoderConfig: { codec: audio.codec, numberOfChannels: audio.audio?.channel_count ?? 2, sampleRate: audio.audio?.sample_rate ?? 44100, description } } : undefined;
      muxer.addAudioChunkRaw(s.data!, "key", (s.cts * 1e6) / s.timescale, (s.duration * 1e6) / s.timescale, meta);
      first = false;
    }
  }
  muxer.finalize();
  const data = new Uint8Array(muxer.target.buffer);
  const note = `${width} by ${height} made ${w} by ${h}, at ${(bitrate / 1e6).toFixed(1)} megabits a second${audio ? ", its sound copied as it was" : ""}.`;
  return { data, note };
}
