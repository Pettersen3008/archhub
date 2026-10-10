use archhub_core::{Service, domain::*, execution, now};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Mutex,
};

#[derive(Clone, Default)]
pub struct RemovalTasks {
    task: Arc<Mutex<Option<RemovalTask>>>,
    next: Arc<AtomicU64>,
    record: Option<PathBuf>,
    load_error: Option<String>,
}

fn capability() -> Result<(), String> {
    for path in [
        execution::HELPER_PATH,
        execution::POLICY_PATH,
        "/usr/bin/pkexec",
    ] {
        execution::trusted_path(Path::new(path)).map_err(|_| {
            "Install the ArchHub system helper package to enable authenticated removal.".to_owned()
        })?;
        if !Path::new(path).is_file() {
            return Err("The ArchHub system helper installation is incomplete.".into());
        }
    }
    let policy = std::fs::read_to_string(execution::POLICY_PATH).map_err(|e| e.to_string())?;
    if policy != include_str!("../../packaging/dev.archhub.remove.policy") {
        return Err("The installed removal authentication policy differs from this build.".into());
    }
    Ok(())
}

impl RemovalTasks {
    pub fn persistent(path: PathBuf) -> Self {
        let loaded = (|| {
            let file = match std::fs::File::open(&path) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(e) => return Err(e.to_string()),
            };
            let mut bytes = Vec::new();
            file.take(524_289)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 524_288 {
                return Err("Saved task exceeds its limit".into());
            }
            let mut task: RemovalTask =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            execution::validate_request(&task.request).map_err(|e| e.to_string())?;
            if task.id == u64::MAX {
                return Err("Invalid saved task identity".into());
            }
            if task.status == "running" {
                task.status = "unknown".into();
                task.outcome = None;
                task.finished_at = Some(now());
                task.diagnostics.push_str("\nArchHub restarted before an outcome was recorded. Package changes may have occurred; refresh inventory and inspect pacman's log. Do not remove a database lock without establishing that its owner ended.");
            }
            Ok::<_, String>(Some(task))
        })();
        match loaded {
            Ok(task) => Self {
                next: Arc::new(AtomicU64::new(task.as_ref().map_or(0, |task| task.id))),
                task: Arc::new(Mutex::new(task)),
                record: Some(path),
                load_error: None,
            },
            Err(error) => Self {
                record: Some(path),
                load_error: Some(format!(
                    "Cannot read the last removal record: {error}. Inspect pacman's log before further removal."
                )),
                ..Self::default()
            },
        }
    }
    fn save(&self, task: &RemovalTask) -> Result<(), String> {
        let Some(path) = &self.record else {
            return Ok(());
        };
        let parent = path.parent().ok_or("Missing task record directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, task).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
        std::fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn close_blocked(&self) -> bool {
        self.task.try_lock().map_or(true, |task| {
            task.as_ref().is_some_and(|t| t.status == "running")
        })
    }

    pub async fn state(&self) -> RemovalTaskState {
        let available = self.load_error.clone().map_or_else(capability, Err);
        RemovalTaskState {
            available: available.is_ok(),
            unavailable_reason: available.err(),
            task: self.task.lock().await.clone(),
        }
    }
    pub async fn start(
        &self,
        service: &Service,
        request: RemovalApplyRequest,
    ) -> Result<RemovalTask, String> {
        execution::validate_request(&request).map_err(|e| e.to_string())?;
        if let Some(error) = &self.load_error {
            return Err(error.clone());
        }
        capability()?;
        let mut task = self.task.lock().await;
        if task.as_ref().is_some_and(|t| t.status == "running") {
            return Err("A removal task is already running. Wait for its outcome.".into());
        }
        // Verify the exact UI capture again before presenting authentication.
        let plan: RemovalPlan = serde_json::from_value(
            service
                .execute(Request::RemovalPlan {
                    targets: request.targets.clone(),
                    fingerprint: request.fingerprint.clone(),
                })
                .await
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if !plan.dependency_check_passed
            || !plan.held_packages.is_empty()
            || plan.execution_digest.as_deref() != Some(&request.execution_digest)
        {
            return Err(
                "The reviewed removal changed or is blocked. Review again before authentication."
                    .into(),
            );
        }
        let current = RemovalTask {
            id: self.next.fetch_add(1, Ordering::Relaxed) + 1,
            request: request.clone(),
            started_at: now(),
            finished_at: None,
            status: "running".into(),
            outcome: None,
            diagnostics: String::new(),
        };
        self.save(&current)
            .map_err(|e| format!("Cannot save removal task before authentication: {e}"))?;
        *task = Some(current.clone());
        let state = self.clone();
        let service = service.clone();
        tauri::async_runtime::spawn(async move {
            let result = run(request).await;
            let refresh = service.execute(Request::Snapshot { refresh: true }).await;
            let mut task = state.task.lock().await;
            if let Some(task) = task.as_mut() {
                task.finished_at = Some(now());
                match result {
                    Ok((outcome, diagnostics)) => {
                        task.status = outcome.status.clone();
                        task.outcome = Some(outcome);
                        task.diagnostics = diagnostics;
                    }
                    Err(error) => {
                        task.status = "unknown".into();
                        task.diagnostics = error;
                    }
                }
                if let Err(error) = refresh {
                    task.status = "unknown".into();
                    task.diagnostics.push_str(&format!(
                        "\nCannot refresh package state after this attempt: {error}"
                    ));
                }
                if let Err(error) = state.save(task) {
                    task.status = "unknown".into();
                    task.diagnostics.push_str(&format!(
                        "\nCannot retain the removal outcome: {error}. Inspect pacman's log."
                    ));
                }
            }
        });
        Ok(current)
    }
}

// Drain excessive diagnostics without terminating a possible commit. Losing the
// UI observer never aborts or retries this native-owned task.
async fn drain(
    mut stream: impl AsyncRead + Unpin,
    limit: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut saved = Vec::new();
    let mut truncated = false;
    let mut chunk = [0u8; 8192];
    loop {
        let count = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        let keep = count.min(limit.saturating_sub(saved.len()));
        saved.extend_from_slice(&chunk[..keep]);
        truncated |= keep < count;
    }
    Ok((saved, truncated))
}
struct ProcessOutput {
    status: std::process::ExitStatus,
    output: (Vec<u8>, bool),
    diagnostics: (Vec<u8>, bool),
    written: Result<(), String>,
}
async fn communicate(
    mut child: tokio::process::Child,
    input: &[u8],
) -> Result<ProcessOutput, String> {
    let mut stdin = child.stdin.take().ok_or("No helper input stream")?;
    let out = child.stdout.take().ok_or("No helper output stream")?;
    let err = child.stderr.take().ok_or("No helper diagnostics stream")?;
    let write = async {
        stdin.write_all(input).await.map_err(|e| e.to_string())?;
        drop(stdin);
        Ok::<_, String>(())
    };
    // Readers drain while the helper runs; only after it has exited may inherited
    // pipes time out. Never impose a commit deadline or kill the transaction.
    let readers = async { tokio::join!(drain(out, 262_144), drain(err, 65_536), write) };
    tokio::pin!(readers);
    let (status, result) = tokio::select! {
        result = &mut readers => (child.wait().await, result),
        status = child.wait() => {
            let result = tokio::time::timeout(std::time::Duration::from_secs(5), &mut readers)
                .await.map_err(|_| "Helper exited but its output pipes remained open; outcome is unknown.".to_owned())?;
            (status, result)
        }
    };
    let (output, diagnostics, written) = result;
    let status = status.map_err(|e| e.to_string())?;
    Ok(ProcessOutput {
        status,
        output: output?,
        diagnostics: diagnostics?,
        written,
    })
}
async fn run(request: RemovalApplyRequest) -> Result<(RemovalOutcome, String), String> {
    capability()?;
    let input = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    let child = Command::new("/usr/bin/pkexec")
        .args(["--disable-internal-agent", execution::HELPER_PATH, "remove"])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .current_dir("/")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let ProcessOutput {
        status,
        output,
        diagnostics,
        written,
    } = communicate(child, &input).await?;
    let (output, truncated) = output;
    let (diagnostics, diagnostics_truncated) = diagnostics;
    let mut diagnostics = String::from_utf8_lossy(&diagnostics).into_owned();
    if diagnostics_truncated {
        diagnostics.push_str("\nFurther diagnostics were omitted.");
    }
    if matches!(status.code(), Some(126 | 127)) && output.is_empty() {
        return Ok((
            RemovalOutcome {
                status: "rejected".into(),
                message: if status.code() == Some(126) {
                    "Authentication was cancelled; removal was not started."
                } else {
                    "Authentication was denied or unavailable; removal was not started."
                }
                .into(),
                targets: request.targets,
                remaining: Vec::new(),
                finished_at: now(),
            },
            diagnostics,
        ));
    }
    written.map_err(|e| format!("Helper communication failed; outcome is unknown: {e}"))?;
    if truncated {
        return Err("Helper outcome exceeded its limit. Package changes may have occurred; refresh inventory and inspect pacman's log.".into());
    }
    let outcome:RemovalOutcome=serde_json::from_slice(&output).map_err(|_|"Helper ended without a valid outcome. Package changes may have occurred; refresh inventory and inspect pacman's log.".to_owned())?;
    if !["removed", "rejected", "partial"].contains(&outcome.status.as_str())
        || (outcome.status == "removed"
            && (!status.success()
                || !outcome.remaining.is_empty()
                || serde_json::to_value(&outcome.targets).ok()
                    != serde_json::to_value(&request.targets).ok()))
    {
        return Err("Helper outcome does not match the requested removal. Refresh inventory before any further action.".into());
    }
    Ok((outcome, diagnostics))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn output_is_drained_without_unbounded_capture() {
        let (mut writer, reader) = tokio::io::duplex(64);
        let writing = tokio::spawn(async move {
            writer.write_all(&vec![b'x'; 10000]).await.unwrap();
        });
        let (bytes, truncated) = drain(reader, 100).await.unwrap();
        writing.await.unwrap();
        assert_eq!(bytes.len(), 100);
        assert!(truncated);
    }
    #[tokio::test]
    async fn missing_helper_cannot_launch_a_task() {
        if !Path::new(execution::HELPER_PATH).exists() {
            assert!(capability().is_err());
            assert!(!RemovalTasks::default().state().await.available);
        }
    }
    fn fixture_task() -> RemovalTask {
        RemovalTask {
            id: 7,
            request: RemovalApplyRequest {
                protocol: 1,
                targets: vec![RemovalTarget {
                    name: "fixture".into(),
                    version: "1-1".into(),
                }],
                fingerprint: "a".repeat(64),
                execution_digest: "b".repeat(64),
            },
            started_at: now(),
            finished_at: None,
            status: "running".into(),
            outcome: None,
            diagnostics: String::new(),
        }
    }
    #[tokio::test]
    async fn restart_marks_unfinished_task_unknown_without_replaying_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task.json");
        let tasks = RemovalTasks::persistent(path.clone());
        tasks.save(&fixture_task()).unwrap();
        let restored = RemovalTasks::persistent(path);
        let task = restored.state().await.task.unwrap();
        assert_eq!(task.id, 7);
        assert_eq!(task.status, "unknown");
        assert!(task.outcome.is_none());
        assert!(task.diagnostics.contains("restarted"));
        assert!(!restored.close_blocked());
        assert_eq!(restored.next.load(Ordering::Relaxed), 7);
    }
    #[tokio::test]
    async fn completed_task_survives_restart_and_corrupt_records_disable_removal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task.json");
        let tasks = RemovalTasks::persistent(path.clone());
        let mut task = fixture_task();
        task.status = "rejected".into();
        task.finished_at = Some(now());
        tasks.save(&task).unwrap();
        assert_eq!(
            RemovalTasks::persistent(path.clone())
                .state()
                .await
                .task
                .unwrap()
                .status,
            "rejected"
        );
        std::fs::write(&path, "malformed").unwrap();
        let bad = RemovalTasks::persistent(path).state().await;
        assert!(!bad.available);
        assert!(
            bad.unavailable_reason
                .unwrap()
                .contains("last removal record")
        );
    }
    #[tokio::test]
    async fn active_task_blocks_close_and_unwritable_record_prevents_launch() {
        let tasks = RemovalTasks::default();
        *tasks.task.lock().await = Some(fixture_task());
        assert!(tasks.close_blocked());
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("not-a-directory");
        std::fs::write(&parent, "file").unwrap();
        assert!(
            RemovalTasks::persistent(parent.join("task.json"))
                .save(&fixture_task())
                .is_err()
        );
    }
    #[tokio::test]
    async fn pipes_inherited_after_exit_do_not_leave_a_task_running_forever() {
        let mut command = Command::new("/usr/bin/python");
        command.args([
            "-c",
            "import os,time; pid=os.fork(); time.sleep(6) if pid == 0 else None",
        ]);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let started = std::time::Instant::now();
        let result = communicate(command.spawn().unwrap(), b"{}").await;
        assert!(result.err().unwrap().contains("pipes remained open"));
        assert!(started.elapsed() < std::time::Duration::from_secs(6));
    }
    #[tokio::test]
    async fn helper_is_allowed_to_finish_before_output_timeout_starts() {
        let mut command = Command::new("/usr/bin/python");
        command.args([
            "-c",
            "import sys,time; sys.stdin.read(); time.sleep(0.15); print('completed')",
        ]);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let result = communicate(command.spawn().unwrap(), b"{}").await.unwrap();
        assert!(result.status.success());
        assert_eq!(result.output.0, b"completed\n");
    }
}
