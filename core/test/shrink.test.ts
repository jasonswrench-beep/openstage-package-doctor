import { test } from "node:test";
import assert from "node:assert/strict";
import { open, PAGE, scorm12 } from "./helpers.ts";
import { readWav, shrinkWav } from "../src/media/wav.ts";
import { DEFAULT_SHRINK, isSpriteSheet, shrinkCandidates, worthKeeping } from "../src/media/shrink.ts";

/** A stereo 16-bit WAV at 44,100 a second: a 440 Hz tone on the left, silence on the right. */
function tone(seconds: number): Uint8Array {
  const frames = Math.round(44100 * seconds);
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const put = (at: number, s: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i); };
  put(0, "RIFF"); view.setUint32(4, 36 + frames * 4, true); put(8, "WAVE"); put(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); put(36, "data"); view.setUint32(40, frames * 4, true);
  for (let f = 0; f < frames; f++) view.setInt16(44 + f * 4, Math.round(Math.sin((2 * Math.PI * 440 * f) / 44100) * 16000), true);
  return bytes;
}

test("a stereo WAV becomes a mono one at 22,050 a second, a quarter of the size, the same length", () => {
  const wav = tone(1);
  const small = shrinkWav(wav)!;
  const info = readWav(small)!;
  assert.deepEqual([info.channels, info.sampleRate, info.bitsPerSample, info.format], [1, 22050, 16, 1]);
  assert.equal(info.dataLength / 2 / 22050, 1);
  assert.ok(small.length < wav.length / 3.9);
  // The tone is still there: its loudest sample is about half the left channel's (mixed with silence).
  const view = new DataView(small.buffer);
  let peak = 0;
  for (let i = 0; i < info.dataLength / 2; i++) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true)));
  assert.ok(peak > 7000 && peak < 8500, `peak ${peak}`);
});

test("a WAV that is already small, or not a WAV, is left alone", () => {
  const small = shrinkWav(tone(0.5))!;
  assert.equal(shrinkWav(small), null);
  assert.equal(shrinkWav(new TextEncoder().encode("not a sound file at all, really, no")), null);
});

test("the candidates are photographs, videos and WAVs big enough to matter, never sprite sheets", () => {
  const big = "x".repeat(200 * 1024);
  const r = open({
    "imsmanifest.xml": scorm12(),
    "index.html": PAGE,
    "images/photo.jpg": big,
    "images/small.jpg": "x",
    "images/logo.png": big,
    "images/game_atlas_1.jpg": big,
    "media/intro.mp4": "v".repeat(2 * 1024 * 1024),
    "media/voice.wav": big,
  });
  assert.deepEqual(shrinkCandidates(r, DEFAULT_SHRINK).map((c) => `${c.kind} ${c.path}`), ["video media/intro.mp4", "picture images/photo.jpg", "sound media/voice.wav"]);
  assert.deepEqual(shrinkCandidates(r, { ...DEFAULT_SHRINK, video: false, sound: false }).map((c) => c.path), ["images/photo.jpg"]);
  assert.ok(isSpriteSheet("anim/Sprite-Sheet.png"));
  assert.ok(!isSpriteSheet("sprites/photo.jpg"), "only the file's own name counts");
  assert.ok(worthKeeping(100, 90) && !worthKeeping(100, 91));
});
