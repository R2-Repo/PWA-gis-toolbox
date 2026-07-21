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
    // Prefer RTT on a real Reply line (Windows: "time=12ms" / "time<1ms")
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        if !lower.contains("reply from") {
            continue;
        }
        if let Some(idx) = lower.find("time") {
            let slice = &line[idx..];
            let slice_l = slice.to_lowercase();
            if slice_l.contains("time<1ms") {
                return Some(0.5);
            }
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

/// Windows often exits 0 with "0% loss" for ICMP *errors* from a router
/// ("TTL expired in transit", "Destination net unreachable") — not an echo reply.
fn is_icmp_error_reply(stdout_lower: &str) -> bool {
    const ERRORS: &[&str] = &[
        "ttl expired",
        "destination host unreachable",
        "destination net unreachable",
        "destination network unreachable",
        "destination protocol unreachable",
        "destination port unreachable",
        "general failure",
        "transmit failed",
        "request timed out",
        "could not find host",
        "unknown host",
        "100% loss",
        "lost = 1",
    ];
    ERRORS.iter().any(|e| stdout_lower.contains(e))
}

/// True only when stdout shows an echo reply from the target itself.
/// Example success: `Reply from 10.231.255.1: bytes=32 time=12ms TTL=64`
/// Example false positive we reject: `Reply from 10.255.0.1: TTL expired in transit.`
fn has_echo_reply_from_target(target: &str, stdout: &str) -> bool {
    let target_l = target.trim().to_ascii_lowercase();
    if target_l.is_empty() {
        return false;
    }
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        let Some(idx) = lower.find("reply from ") else {
            continue;
        };
        let rest = &lower[idx + "reply from ".len()..];
        // "10.1.2.3: bytes=..." or "10.1.2.3: ttl expired..."
        let from = rest.split(':').next().unwrap_or("").trim();
        if from != target_l {
            continue;
        }
        // Must look like a successful echo (bytes=/time=), not an ICMP error line.
        if lower.contains("ttl expired")
            || lower.contains("unreachable")
            || lower.contains("general failure")
        {
            continue;
        }
        if lower.contains("bytes=") || lower.contains("time=") || lower.contains("time<") {
            return true;
        }
    }
    false
}

fn has_unix_echo_reply_from_target(target: &str, stdout_lower: &str) -> bool {
    let target_l = target.trim().to_ascii_lowercase();
    if target_l.is_empty() {
        return false;
    }
    // "64 bytes from 10.1.2.3: icmp_seq=1 ttl=64 time=1.23 ms"
    for line in stdout_lower.lines() {
        let Some(rest) = line.find("bytes from ").map(|i| &line[i + "bytes from ".len()..]) else {
            continue;
        };
        let from = rest
            .split(|c| c == ':' || c == ' ')
            .next()
            .unwrap_or("")
            .trim();
        if from == target_l && line.contains("time=") {
            return true;
        }
    }
    false
}

/// Classify ping stdout. Exit code alone is unreliable on Windows
/// (router ICMP errors still report 0% loss / exit 0).
fn classify_ping_stdout(target: &str, stdout: &str) -> (bool, Option<String>) {
    let lower = stdout.to_lowercase();
    if is_icmp_error_reply(&lower) {
        let hint = if lower.contains("ttl expired") {
            "TTL expired in transit (no echo reply from target)"
        } else if lower.contains("net unreachable") || lower.contains("network unreachable") {
            "Destination net unreachable"
        } else if lower.contains("host unreachable") {
            "Destination host unreachable"
        } else if lower.contains("timed out") {
            "Request timed out"
        } else {
            "Host unreachable"
        };
        return (false, Some(hint.into()));
    }
    if has_echo_reply_from_target(target, stdout) || has_unix_echo_reply_from_target(target, &lower)
    {
        return (true, None);
    }
    (false, Some("No echo reply from target".into()))
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
            let (ok, classify_err) = classify_ping_stdout(ip, &stdout);
            if ok {
                PingResult {
                    ip: ip.to_string(),
                    status: "reachable".into(),
                    rtt_ms: parse_rtt_ms(&stdout),
                    error: None,
                }
            } else {
                let err = classify_err
                    .or_else(|| {
                        let s = stderr.trim();
                        if s.is_empty() {
                            None
                        } else {
                            Some(s.to_string())
                        }
                    })
                    .unwrap_or_else(|| "Request timed out or host unreachable".into());
                PingResult {
                    ip: ip.to_string(),
                    status: "unreachable".into(),
                    rtt_ms: None,
                    error: Some(err),
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

#[cfg(test)]
mod tests {
    use super::{classify_ping_stdout, has_echo_reply_from_target, parse_rtt_ms};

    #[test]
    fn rejects_ttl_expired_from_router() {
        let stdout = "\
Pinging 10.231.255.1 with 32 bytes of data:\r\n\
Reply from 10.255.0.1: TTL expired in transit.\r\n\
\r\n\
Ping statistics for 10.231.255.1:\r\n\
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n";
        let (ok, err) = classify_ping_stdout("10.231.255.1", stdout);
        assert!(!ok, "TTL expired must not count as reachable");
        assert!(err.unwrap().to_lowercase().contains("ttl"));
        assert!(!has_echo_reply_from_target("10.231.255.1", stdout));
    }

    #[test]
    fn rejects_destination_net_unreachable() {
        let stdout = "\
Pinging 192.0.2.1 with 32 bytes of data:\r\n\
Reply from 4.1.1.1: Destination net unreachable.\r\n\
\r\n\
Ping statistics for 192.0.2.1:\r\n\
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n";
        let (ok, _) = classify_ping_stdout("192.0.2.1", stdout);
        assert!(!ok);
    }

    #[test]
    fn accepts_real_echo_reply_from_target() {
        let stdout = "\
Pinging 10.231.255.1 with 32 bytes of data:\r\n\
Reply from 10.231.255.1: bytes=32 time=12ms TTL=64\r\n\
\r\n\
Ping statistics for 10.231.255.1:\r\n\
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n\
Approximate round trip times in milli-seconds:\r\n\
    Minimum = 12ms, Maximum = 12ms, Average = 12ms\r\n";
        let (ok, err) = classify_ping_stdout("10.231.255.1", stdout);
        assert!(ok, "err={err:?}");
        assert_eq!(parse_rtt_ms(stdout), Some(12.0));
    }
}
