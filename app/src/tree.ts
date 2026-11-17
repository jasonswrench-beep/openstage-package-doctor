// Turns the package's flat list of files into folders, with each folder's file count and size, for the Files section.

import type { PackageFile } from "../../core/src/model.ts";

export interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  files: PackageFile[];
  fileCount: number;
  size: number;
}

export function buildTree(files: PackageFile[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], files: [], fileCount: 0, size: 0 };
  const index = new Map<string, Folder>([["", root]]);
  const folderFor = (path: string): Folder => {
    const found = index.get(path);
    if (found) return found;
    const trimmed = path.slice(0, -1);
    const slash = trimmed.lastIndexOf("/");
    const parent = folderFor(slash < 0 ? "" : trimmed.slice(0, slash + 1));
    const folder: Folder = { name: trimmed.slice(slash + 1), path, folders: [], files: [], fileCount: 0, size: 0 };
    parent.folders.push(folder);
    index.set(path, folder);
    return folder;
  };
  for (const f of files) {
    const slash = f.path.lastIndexOf("/");
    folderFor(slash < 0 ? "" : f.path.slice(0, slash + 1)).files.push(f);
  }
  const total = (folder: Folder): void => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name, "en"));
    folder.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    for (const sub of folder.folders) total(sub);
    folder.fileCount = folder.files.length + folder.folders.reduce((s, x) => s + x.fileCount, 0);
    folder.size = folder.files.reduce((s, f) => s + f.size, 0) + folder.folders.reduce((s, x) => s + x.size, 0);
  };
  total(root);
  return root;
}
