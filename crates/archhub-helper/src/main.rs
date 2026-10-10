use archhub_core::{
    domain::{RemovalApplyRequest, RemovalOutcome},
    execution,
};
use std::io::{Read, Write};

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--protocol"] {
        println!("1");
        return;
    }
    let result = (|| {
        if args != ["remove"] {
            return Err("Usage: archhub-helper remove (bounded JSON on stdin)".to_owned());
        }
        if !nix::unistd::Uid::effective().is_root() {
            return Err("Administrator authentication is required.".to_owned());
        }
        let own = std::env::current_exe().map_err(|e| e.to_string())?;
        if own != std::path::Path::new(execution::HELPER_PATH) {
            return Err("The helper must be installed at its fixed system path.".to_owned());
        }
        execution::trusted_path(&own).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        std::io::stdin()
            .lock()
            .take(32_769)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 32_768 {
            return Err("Removal request exceeds the input limit.".to_owned());
        }
        let request: RemovalApplyRequest =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid removal request.".to_owned())?;
        execution::apply_removal(request).map_err(|e| e.to_string())
    })();
    let (outcome, code) = match result {
        Ok(outcome) => {
            let code = if outcome.status == "removed" { 0 } else { 1 };
            (outcome, code)
        }
        Err(message) => (
            RemovalOutcome {
                status: "rejected".into(),
                message,
                targets: Vec::new(),
                remaining: Vec::new(),
                finished_at: archhub_core::now(),
            },
            1,
        ),
    };
    let mut stdout = std::io::stdout().lock();
    if serde_json::to_writer(&mut stdout, &outcome).is_err() || stdout.write_all(b"\n").is_err() {
        std::process::exit(2);
    }
    std::process::exit(code);
}
