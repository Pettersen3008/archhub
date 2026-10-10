#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod removal_tasks;
#[cfg(debug_assertions)]
mod smoke;
use archhub_core::{Service, domain::Request};

#[tauri::command]
async fn removal_task_state(
    tasks: tauri::State<'_, removal_tasks::RemovalTasks>,
) -> Result<archhub_core::domain::RemovalTaskState, String> {
    Ok(tasks.state().await)
}

#[tauri::command]
async fn start_removal_task(
    tasks: tauri::State<'_, removal_tasks::RemovalTasks>,
    service: tauri::State<'_, Service>,
    request: archhub_core::domain::RemovalApplyRequest,
) -> Result<archhub_core::domain::RemovalTask, String> {
    tasks.start(&service, request).await
}

#[tauri::command]
async fn query(
    service: tauri::State<'_, Service>,
    request: Request,
) -> Result<serde_json::Value, String> {
    service.execute(request).await.map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            use tauri::Manager;
            let service = tauri::async_runtime::block_on(Service::new())?;
            app.manage(service);
            app.manage(removal_tasks::RemovalTasks::persistent(
                app.path().app_local_data_dir()?.join("removal-task.json"),
            ));
            #[cfg(debug_assertions)]
            if std::env::var_os("ARCHHUB_SMOKE_TEST").is_some() {
                use tauri_plugin_fs::FsExt;
                app.fs_scope().allow_file(smoke::output_path())?;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    if let Some(window) = handle.get_webview_window("main")
                        && let Err(error) = window.eval(smoke::script().as_str())
                    {
                        eprintln!("Native smoke hook failed: {error}");
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window
                    .state::<removal_tasks::RemovalTasks>()
                    .close_blocked()
            {
                api.prevent_close();
                let _ = window.emit("removal-close-blocked", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            query,
            removal_task_state,
            start_removal_task
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start ArchHub");
}
