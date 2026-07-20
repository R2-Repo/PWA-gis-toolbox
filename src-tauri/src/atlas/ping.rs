use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

#[derive(Default)]
pub struct AtlasPingState {
    canceled: Mutex<HashSet<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub ip: String,
    pub status: String,
    pub rtt_ms: Option<f64>,
    pub error: Option<String>,
}

fn is_valid_ip_or_host(target: &str) -> bool {
    let t = target.trim();
    if t.is_empty() || t.len() > 253 {
        return false;
    }
    // Reject shell metacharacters — only allow IP / hostname chars
    t.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == ':' || c == '-')
}

fn parse_rtt_ms(stdout: &str) -> Option<f64> {
    // Windows: "Average = 12ms" or "time=12ms" / "time<1ms"
    for line in stdout.lines() {
        if let Some(idx) = line.to_lowercase().find("time") {
            let slice = &line[idx..];
            if let Some(eq) = slice.find('=') {
                let rest = slice[eq + 1..].trim();
                let num: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect();
                if let Ok(v) = num.parse::<f64>() {
                    return Some(v);
                }
            }
            if slice.to_lowercase().contains("time<1ms") {
                return Some(0.5);
            }
        }
        if let Some(idx) = line.to_lowercase().find("average") {
            let slice = &line[idx..];
            if let Some(eq) = slice.find('=') {
                let rest = slice[eq + 1..].trim();
                let num: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect();
                if let Ok(v) = num.parse::<f64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn ping_one_impl(ip: &str, timeout_ms: u64) -> PingResult {
    if !is_valid_ip_or_host(ip) {
        return PingResult {
            ip: ip.to_string(),
            status: "unreachable".into(),
            rtt_ms: None,
            error: Some("Invalid IP or host".into()),
        };
    }

    #[cfg(windows)]
    let output = Command::new("ping")
        .args(["-n", "1", "-w", &timeout_ms.to_string(), ip])
        .output();

    #[cfg(not(windows))]
    let output = {
        let timeout_sec = ((timeout_ms.max(500)) / 1000).max(1);
        Command::new("ping")
            .args(["-c", "1", "-W", &timeout_sec.to_string(), ip])
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let ok = out.status.success()
                && !stdout.to_lowercase().contains("destination host unreachable")
                && !stdout.to_lowercase().contains("request timed out")
                && !stdout.to_lowercase().contains("100% loss");
            if ok {
                PingResult {
                    ip: ip.to_string(),
                    status: "reachable".into(),
                    rtt_ms: parse_rtt_ms(&stdout),
                    error: None,
                }
            } else {
                PingResult {
                    ip: ip.to_string(),
                    status: "unreachable".into(),
                    rtt_ms: None,
                    error: Some(if stderr.trim().is_empty() {
                        "Request timed out or host unreachable".into()
                    } else {
                        stderr.trim().to_string()
                    }),
                }
            }
        }
        Err(err) => PingResult {
            ip: ip.to_string(),
            status: "unreachable".into(),
            rtt_ms: None,
            error: Some(format!("Failed to run ping: {err}")),
        },
    }
}

#[tauri::command]
pub fn atlas_ping_one(ip: String, timeout_ms: Option<u64>) -> PingResult {
    let _ = Duration::from_millis(timeout_ms.unwrap_or(2000));
    ping_one_impl(&ip, timeout_ms.unwrap_or(2000))
}

#[tauri::command]
pub fn atlas_ping_many(
    ips: Vec<String>,
    timeout_ms: Option<u64>,
    concurrency: Option<usize>,
    state: tauri::State<'_, Arc<AtlasPingState>>,
) -> Vec<PingResult> {
    let timeout = timeout_ms.unwrap_or(2000);
    let concurrency = concurrency.unwrap_or(8).clamp(1, 32);
    let mut results = Vec::with_capacity(ips.len());
    let mut chunk_start = 0;
    while chunk_start < ips.len() {
        if state.canceled.lock().contains("__all__") {
            break;
        }
        let end = (chunk_start + concurrency).min(ips.len());
        let chunk = &ips[chunk_start..end];
        // Sequential within chunk for predictable Windows ping.exe usage
        for ip in chunk {
            results.push(ping_one_impl(ip, timeout));
        }
        chunk_start = end;
    }
    results
}

#[tauri::command]
pub fn atlas_ping_cancel(session_id: String, state: tauri::State<'_, Arc<AtlasPingState>>) {
    let _ = session_id;
    state.canceled.lock().insert("__all__".into());
}
