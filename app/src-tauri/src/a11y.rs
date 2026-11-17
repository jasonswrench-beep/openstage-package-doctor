// The accessibility check (roadmap item 5): the suite's rules, A11Y-1, run by the suite's engine, `openstage-a11y`
// (openstage-core, tag a11y-v0.1.0), on the files of a package. The window picks the files out of the zip and sends
// them here in one message; nothing is unpacked to disk. The pages are checked together, as a site, with the style
// sheets they link to, the way the engine checks a folder of pages; each Word, PowerPoint and captions file is checked
// on its own. Findings warn and never block: Package Doctor has no project, so no rule is ever a blocker.

use openstage_a11y::{dom::Dom, html, paths, text_of, Collector, Input, Options, Report};
use serde::Serialize;
use std::collections::BTreeMap;

/// The most pages checked, as the engine's own folder check allows.
const MAX_PAGES: usize = 5000;
/// The most a style sheet may be, as the engine's own folder check allows.
const MAX_SHEET: usize = 16 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageCheck {
    /// The pages, checked together; none when the package has no pages.
    pub pages: Option<Report>,
    /// Each document checked on its own, with its path in the package.
    pub documents: Vec<Document>,
    /// What could not be checked, in words.
    pub limits: Vec<String>,
}

#[derive(Serialize)]
pub struct Document {
    pub path: String,
    pub report: Report,
}

fn extension(path: &str) -> String {
    path.rsplit('.').next().map(|e| e.to_ascii_lowercase()).unwrap_or_default()
}

/// Checks a package's files. `files` maps each path (from the top of the zip, with `/`) to its bytes; `root` is the
/// folder the package's manifest is in, and only files under it are the course's.
pub fn check_package(name: &str, root: &str, files: &BTreeMap<String, Vec<u8>>) -> PackageCheck {
    let mut limits = Vec::new();
    let mine = |p: &str| p.starts_with(root);
    let mut pages: Vec<&String> = files.keys().filter(|p| mine(p) && matches!(extension(p).as_str(), "html" | "htm" | "xhtml")).collect();
    pages.sort();
    if pages.len() > MAX_PAGES {
        limits.push(format!("Only the first {MAX_PAGES} of {} pages were checked.", pages.len()));
        pages.truncate(MAX_PAGES);
    }

    let page_report = if pages.is_empty() {
        None
    } else {
        let mut c = Collector::new("html");
        for page in &pages {
            let text = text_of(&files[*page]);
            let dom = Dom::parse_html(&text);
            let folder = paths::dir(page);
            let load = |href: &str| -> Option<String> {
                let path = paths::resolve(&folder, href)?;
                files.get(&path).filter(|b| b.len() <= MAX_SHEET).map(|b| text_of(b))
            };
            let sheet = html::sheet_for(page, &dom, &load);
            let mut one = Collector::new("html");
            let mut outline = Vec::new();
            html::check_page(page, &dom, &sheet, html::PageKind::Web, &mut one, &mut outline);
            if dom.truncated {
                one.limit(&format!("{page} is very large; only its first part was read."));
            }
            c.absorb(one);
        }
        Some(c.finish(Input { name: name.to_string(), kind: "site".into(), files: pages.len() as u32 }))
    };

    let mut documents = Vec::new();
    let mut pdfs = 0;
    for (path, bytes) in files.iter().filter(|(p, _)| mine(p)) {
        match extension(path).as_str() {
            "docx" | "pptx" | "vtt" | "epub" => match openstage_a11y::check_bytes(path, bytes, &Options::default()) {
                Ok(mut report) => {
                    report.input.name = path.clone();
                    documents.push(Document { path: path.clone(), report });
                }
                Err(e) => limits.push(format!("{path} could not be checked: {e}.")),
            },
            "pdf" => pdfs += 1,
            _ => {}
        }
    }
    if pdfs > 0 {
        limits.push(format!(
            "{} not checked: this version of the engine does not read PDFs yet (A11Y-1 section 6.6). PDF Remediator checks them.",
            if pdfs == 1 { "The PDF in the package was".to_string() } else { format!("The {pdfs} PDFs in the package were") }
        ));
    }
    PackageCheck { pages: page_report, documents, limits }
}

/// The message the window sends: a 4-byte little-endian length, that many bytes of JSON (the package's name, its root,
/// and each file's path and length), then the files' bytes one after another.
pub fn unpack_message(body: &[u8]) -> Result<(String, String, BTreeMap<String, Vec<u8>>), String> {
    #[derive(serde::Deserialize)]
    struct Head {
        name: String,
        root: String,
        files: Vec<(String, usize)>,
    }
    if body.len() < 4 {
        return Err("The message is empty.".into());
    }
    let n = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    let head: Head = serde_json::from_slice(body.get(4..4 + n).ok_or("The message is cut short.")?).map_err(|e| e.to_string())?;
    let mut at = 4 + n;
    let mut files = BTreeMap::new();
    for (path, len) in head.files {
        let bytes = body.get(at..at + len).ok_or("The message is cut short.")?;
        files.insert(path, bytes.to_vec());
        at += len;
    }
    Ok((head.name, head.root, files))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(name: &str, root: &str, files: &[(&str, &str)]) -> Vec<u8> {
        let head = serde_json::json!({ "name": name, "root": root, "files": files.iter().map(|(p, t)| (p.to_string(), t.len())).collect::<Vec<_>>() });
        let head = serde_json::to_vec(&head).unwrap();
        let mut out = (head.len() as u32).to_le_bytes().to_vec();
        out.extend(head);
        for (_, t) in files {
            out.extend(t.as_bytes());
        }
        out
    }

    #[test]
    fn checks_the_pages_with_their_style_sheets_and_the_documents_on_their_own() {
        let msg = message(
            "course.zip",
            "course/",
            &[
                ("course/index.html", r#"<!doctype html><html lang="en"><head><title>Lesson</title><link rel="stylesheet" href="css/look.css"></head><body><main><h1>Lesson</h1><p class="faint">Hello</p><img src="a.png"></main></body></html>"#),
                ("course/css/look.css", ".faint { color: #bbbbbb; background: #ffffff; }"),
                ("course/notes.vtt", "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n"),
                ("course/guide.pdf", "%PDF-1.4"),
                ("other/outside.html", "<html><title>Not the course</title></html>"),
            ],
        );
        let (name, root, files) = unpack_message(&msg).unwrap();
        let check = check_package(&name, &root, &files);
        let pages = check.pages.unwrap();
        assert_eq!(pages.input.files, 1, "only the course's own pages");
        let rules: Vec<&str> = pages.findings.iter().map(|f| f.rule.as_str()).collect();
        assert!(rules.contains(&"alt-missing"), "{rules:?}");
        assert!(rules.contains(&"contrast-text"), "the linked style sheet was read: {rules:?}");
        assert_eq!(check.documents.len(), 1);
        assert_eq!(check.documents[0].path, "course/notes.vtt");
        assert!(check.limits.iter().any(|l| l.contains("The PDF in the package was not checked")));
    }

    #[test]
    fn a_short_message_is_refused_in_words() {
        assert!(unpack_message(&[1, 0]).is_err());
        let mut m = message("x", "", &[("a.html", "<p>")]);
        m.truncate(m.len() - 1);
        assert_eq!(unpack_message(&m).unwrap_err(), "The message is cut short.");
    }
}
