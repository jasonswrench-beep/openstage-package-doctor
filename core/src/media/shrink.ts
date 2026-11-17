// Which files in a package are worth making smaller, and how, in words a person can choose from. The work on pictures
// and video needs a browser's decoders and encoders, so the window does it (app/src/shrink.ts); this part decides,
// does the sound (wav.ts), and keeps the results.
//
// The rules are careful, because a smaller file must still work in the course:
// - A file keeps its name and its format, so nothing that points at it has to change.
// - Pictures drawn by scripts are left alone: a sprite sheet or atlas is cut up by position, and a smaller one would
//   come out wrong. By default only photographs (JPEG and WebP) are made smaller; PNG and GIF are left as they are.
// - A result is kept only when it saves at least a tenth.

import type { OpenedPackage } from "../model.ts";

export type ShrinkKind = "picture" | "video" | "sound";

export interface ShrinkOptions {
  /** Photographs (JPEG, WebP): saved again at `quality`, and made smaller if wider or taller than `maxSide`. */
  pictures: boolean;
  maxSide: number;
  /** 0 to 1, as browsers take it. 0.82 is hard to tell from the original. */
  quality: number;
  /** MP4 video: encoded again as H.264 no taller than `videoHeight`, at `videoBitrate` bits a second. */
  video: boolean;
  videoHeight: number;
  videoBitrate: number;
  /** WAV sound: one channel at 22,050 samples a second. Fine for speech; music loses its top notes. */
  sound: boolean;
  /** Pages, scripts, style sheets and fonts packed again as tightly as possible. Loses nothing. */
  text: boolean;
}

export const DEFAULT_SHRINK: ShrinkOptions = {
  pictures: true,
  maxSide: 1920,
  quality: 0.82,
  video: true,
  videoHeight: 720,
  videoBitrate: 1_500_000,
  sound: true,
  text: true,
};

export interface ShrinkCandidate {
  path: string;
  kind: ShrinkKind;
  size: number;
}

/** A picture a script cuts up by position: making it smaller would break the course. */
export function isSpriteSheet(path: string): boolean {
  return /(atlas|sprite|spritesheet|tileset|texture)/i.test(path.slice(path.lastIndexOf("/") + 1));
}

const SMALLEST = { picture: 100 * 1024, video: 1024 * 1024, sound: 100 * 1024 };

/** The files worth trying, biggest first. */
export function shrinkCandidates(report: OpenedPackage, options: ShrinkOptions): ShrinkCandidate[] {
  const out: ShrinkCandidate[] = [];
  for (const f of report.files) {
    if (f.path.endsWith("/")) continue;
    let kind: ShrinkKind | undefined;
    if (options.pictures && /\.(jpe?g|webp)$/i.test(f.path) && !isSpriteSheet(f.path)) kind = "picture";
    else if (options.video && /\.(mp4|m4v)$/i.test(f.path)) kind = "video";
    else if (options.sound && /\.wav$/i.test(f.path)) kind = "sound";
    if (kind && f.size >= SMALLEST[kind]) out.push({ path: f.path, kind, size: f.size });
  }
  return out.sort((a, b) => b.size - a.size);
}

/** What happened to one file. */
export interface ShrinkResult {
  path: string;
  kind: ShrinkKind;
  before: number;
  after: number;
  /** Whether the smaller file is used. */
  kept: boolean;
  /** Why not, or what was done, in words. */
  note: string;
}

/** Whether a new version is worth keeping: at least a tenth smaller. */
export function worthKeeping(before: number, after: number): boolean {
  return after > 0 && after <= before * 0.9;
}

export const KIND_WORDS: Record<ShrinkKind, string> = { picture: "Picture", video: "Video", sound: "Sound" };
