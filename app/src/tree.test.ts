import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "./tree.ts";

test("folders hold their files, with counts and sizes that include every folder inside them", () => {
  const root = buildTree([
    { path: "index.html", size: 10, packedSize: 5 },
    { path: "media/video/intro.mp4", size: 1000, packedSize: 990 },
    { path: "media/a.png", size: 100, packedSize: 100 },
    { path: "css/site.css", size: 20, packedSize: 8 },
  ]);
  assert.deepEqual(root.folders.map((f) => f.name), ["css", "media"]);
  assert.deepEqual(root.files.map((f) => f.path), ["index.html"]);
  const media = root.folders[1]!;
  assert.equal(media.path, "media/");
  assert.equal(media.fileCount, 2);
  assert.equal(media.size, 1100);
  assert.equal(media.folders[0]!.name, "video");
  assert.equal(root.fileCount, 4);
  assert.equal(root.size, 1130);
});
