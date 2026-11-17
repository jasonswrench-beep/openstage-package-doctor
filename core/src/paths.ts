// Paths inside a package. Every path here is relative to the top of the zip, with forward slashes and no leading slash.
// A folder's path ends with a slash ("images/"); the top of the zip is "".

export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/** Splits a reference into the file part and the rest (`?query` and `#fragment`), and percent-decodes the file part. */
export function splitReference(ref: string): { file: string; rest: string } {
  const cut = ref.search(/[?#]/);
  const file = cut < 0 ? ref : ref.slice(0, cut);
  const rest = cut < 0 ? "" : ref.slice(cut);
  let decoded = file;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    // A stray % stays as it is; the lookup then reports the file missing, which is what a browser would find too.
  }
  return { file: decoded, rest };
}

/** A web address (https:, mailto:, data: ...) or a protocol-relative one (//host/...), rather than a file in the package. */
export function isExternal(ref: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^[a-z]:[\\/]/i.test(ref) || ref.startsWith("//");
}

/**
 * Resolves `ref` against the folder `base`. Returns the path from the top of the zip, or `outside: true` when `../`
 * climbs above the top. Backslashes are read as slashes (a separate finding reports them).
 */
export function resolveIn(base: string, ref: string): { path: string; outside: boolean } {
  const parts = (base + ref.replace(/\\/g, "/")).split("/");
  const out: string[] = [];
  let outside = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const last = i === parts.length - 1;
    if (part === "..") {
      if (out.length) out.pop();
      else outside = true;
      if (last) out.push("");
    } else if (part === "." || (part === "" && !last)) {
      if (last) out.push("");
    } else out.push(part);
  }
  return { path: out.join("/"), outside };
}

export type Lookup = { found: "exact"; path: string } | { found: "case"; path: string } | { found: "missing" };

/** The package's files, for looking a path up the way an LMS server (which tells capitals apart) would. */
export class FileIndex {
  private readonly exact = new Set<string>();
  private readonly folders = new Set<string>([""]);
  private readonly lower = new Map<string, string>();

  constructor(paths: Iterable<string>) {
    for (const p of paths) {
      if (p.endsWith("/")) this.addFolder(p);
      else {
        this.exact.add(p);
        if (!this.lower.has(p.toLowerCase())) this.lower.set(p.toLowerCase(), p);
        this.addFolder(folderOf(p));
      }
    }
  }

  private addFolder(folder: string): void {
    let f = folder;
    while (f && !this.folders.has(f)) {
      this.folders.add(f);
      if (!this.lower.has(f.toLowerCase())) this.lower.set(f.toLowerCase(), f);
      f = folderOf(f.slice(0, -1));
    }
  }

  lookup(path: string): Lookup {
    if (path === "" || path.endsWith("/")) {
      if (this.folders.has(path)) return { found: "exact", path };
    } else if (this.exact.has(path)) return { found: "exact", path };
    const other = this.lower.get(path.toLowerCase());
    return other !== undefined ? { found: "case", path: other } : { found: "missing" };
  }

  has(path: string): boolean {
    return this.exact.has(path);
  }
}
