// The program's Rust side is only the window. Opening and checking a package happens in the web page (../src, using
// ../../core), so the same code runs in the program, in the command line and in the tests.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("OpenStage Package Doctor could not start");
}
