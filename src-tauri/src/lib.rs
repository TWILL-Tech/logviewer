use tauri::ipc::Response;

/// Read a file's raw bytes from a path (typically obtained from a drag-drop
/// event). Returned as a raw IPC `Response` so the frontend receives an
/// ArrayBuffer rather than a JSON number array — this is the one-time load
/// path, kept off the hot path by design.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Write text content to a path (used for CSV crop/export). CSV is text, so a
/// plain String arg avoids binary-arg serialization concerns.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Write raw bytes to a path (used for PNG snapshot export). Bytes arrive as a
/// number array from the frontend; snapshots are small and infrequent.
#[tauri::command]
fn write_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            write_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
