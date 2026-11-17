// The program's Rust side: the window, and one command. Opening and checking a package happens in the web page
// (../src, using ../../core), so the same code runs in the program, in the command line and in the tests. The one
// command is the accessibility check, because the suite's accessibility engine (openstage-a11y, in openstage-core) is
// Rust; the page sends it the package's pages and documents and gets the A11Y-1 report back (a11y.rs).

mod a11y;

/// The most the page may send in one message, so a mistaken or hostile page cannot ask for unbounded memory.
const MAX_MESSAGE: usize = 512 * 1024 * 1024;

#[tauri::command]
fn check_accessibility(request: tauri::ipc::Request<'_>) -> Result<a11y::PackageCheck, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("The accessibility check expects the package's files as bytes.".into());
    };
    if body.len() > MAX_MESSAGE {
        return Err("The package's pages and documents are too large to check at once.".into());
    }
    let (name, root, files) = a11y::unpack_message(body)?;
    Ok(a11y::check_package(&name, &root, &files))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_accessibility])
        .run(tauri::generate_context!())
        .expect("OpenStage Package Doctor could not start");
}
