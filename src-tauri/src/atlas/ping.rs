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
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f64,
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

fn clamp_count(count: Option<u32>) -> u32 {
    count.unwrap_or(4).clamp(1, 8)
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

/// Count successful echo replies from the target itself (not router ICMP errors).
fn count_echo_replies_from_target(target: &str, stdout: &str) -> u32 {
    let target_l = target.trim().to_ascii_lowercase();
    if target_l.is_empty() {
        return 0;
    }
    let mut n = 0u32;
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        let Some(idx) = lower.find("reply from ") else {
            continue;
        };
        let rest = &lower[idx + "reply from ".len()..];
        let from = rest.split(':').next().unwrap_or("").trim();
        if from != target_l {
            continue;
        }
        if lower.contains("ttl expired")
            || lower.contains("unreachable")
            || lower.contains("general failure")
        {
            continue;
        }
        if lower.contains("bytes=") || lower.contains("time=") || lower.contains("time<") {
            n += 1;
        }
    }
    if n > 0 {
        return n;
    }
    // Unix: "64 bytes from 10.1.2.3: icmp_seq=1 ttl=64 time=1.23 ms"
    let lower_all = stdout.to_lowercase();
    for line in lower_all.lines() {
        let Some(rest) = line
            .find("bytes from ")
            .map(|i| &line[i + "bytes from ".len()..])
        else {
            continue;
        };
        let from = rest
            .split(|c| c == ':' || c == ' ')
            .next()
            .unwrap_or("")
            .trim();
        if from == target_l && line.contains("time=") {
            n += 1;
        }
    }
    n
}

/// Classify by echo-reply counts (multi-packet). Exit code / % loss are ignored.
pub fn classify_ping_counts(sent: u32, received: u32) -> &'static str {
    if sent == 0 || received == 0 {
        return "unreachable";
    }
    if received >= sent {
        return "reachable";
    }
    let ratio = received as f64 / sent as f64;
    if ratio < 0.75 {
        "intermittent"
    } else {
        "reachable"
    }
}

fn hint_from_stdout(stdout: &str) -> Option<String> {
    let lower = stdout.to_lowercase();
    if lower.contains("ttl expired") {
        Some("TTL expired in transit (no echo reply from target)".into())
    } else if lower.contains("net unreachable") || lower.contains("network unreachable") {
        Some("Destination net unreachable".into())
    } else if lower.contains("host unreachable") {
        Some("Destination host unreachable".into())
    } else if lower.contains("timed out") {
        Some("Request timed out".into())
    } else {
        None
    }
}

fn ping_one_impl(ip: &str, timeout_ms: u64, count: u32) -> PingResult {
    let sent = count;
    if !is_valid_ip_or_host(ip) {
        return PingResult {
            ip: ip.to_string(),
            status: "unreachable".into(),
            rtt_ms: None,
            sent,
            received: 0,
            loss_pct: 100.0,
            error: Some("Invalid IP or host".into()),
        };
    }

    #[cfg(windows)]
    let output = Command::new("ping")
        .args([
            "-n",
            &count.to_string(),
            "-w",
            &timeout_ms.to_string(),
            ip,
        ])
        .output();

    #[cfg(not(windows))]
    let output = {
        let timeout_sec = ((timeout_ms.max(500)) / 1000).max(1);
        Command::new("ping")
            .args([
                "-c",
                &count.to_string(),
                "-W",
                &timeout_sec.to_string(),
                ip,
            ])
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let received = count_echo_replies_from_target(ip, &stdout).min(sent);
            let status = classify_ping_counts(sent, received).to_string();
            let loss_pct = if sent == 0 {
                100.0
            } else {
                ((sent - received) as f64 / sent as f64) * 100.0
            };
            let rtt_ms = if received > 0 {
                parse_rtt_ms(&stdout)
            } else {
                None
            };
            let error = if status == "reachable" {
                None
            } else {
                hint_from_stdout(&stdout)
                    .or_else(|| {
                        let s = stderr.trim();
                        if s.is_empty() {
                            None
                        } else {
                            Some(s.to_string())
                        }
                    })
                    .or_else(|| {
                        if received == 0 {
                            Some("No echo reply from target".into())
                        } else {
                            Some(format!("Partial loss ({received}/{sent})"))
                        }
                    })
            };
            PingResult {
                ip: ip.to_string(),
                status,
                rtt_ms,
                sent,
                received,
                loss_pct,
                error,
            }
        }
        Err(err) => PingResult {
            ip: ip.to_string(),
            status: "unreachable".into(),
            rtt_ms: None,
            sent,
            received: 0,
            loss_pct: 100.0,
            error: Some(format!("Failed to run ping: {err}")),
        },
    }
}

#[tauri::command]
pub fn atlas_ping_one(
    ip: String,
    timeout_ms: Option<u64>,
    count: Option<u32>,
) -> PingResult {
    let _ = Duration::from_millis(timeout_ms.unwrap_or(2000));
    ping_one_impl(&ip, timeout_ms.unwrap_or(2000), clamp_count(count))
}

#[tauri::command]
pub fn atlas_ping_many(
    ips: Vec<String>,
    timeout_ms: Option<u64>,
    concurrency: Option<usize>,
    count: Option<u32>,
    state: tauri::State<'_, Arc<AtlasPingState>>,
) -> Vec<PingResult> {
    let timeout = timeout_ms.unwrap_or(2000);
    let concurrency = concurrency.unwrap_or(8).clamp(1, 32);
    let packet_count = clamp_count(count);
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
            results.push(ping_one_impl(ip, timeout, packet_count));
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
    use super::{
        classify_ping_counts, count_echo_replies_from_target, parse_rtt_ms,
    };

    #[test]
    fn rejects_ttl_expired_from_router() {
        let stdout = "\
Pinging 10.231.255.1 with 32 bytes of data:\r\n\
Reply from 10.255.0.1: TTL expired in transit.\r\n\
\r\n\
Ping statistics for 10.231.255.1:\r\n\
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n";
        assert_eq!(count_echo_replies_from_target("10.231.255.1", stdout), 0);
        assert_eq!(classify_ping_counts(1, 0), "unreachable");
    }

    #[test]
    fn rejects_destination_net_unreachable() {
        let stdout = "\
Pinging 192.0.2.1 with 32 bytes of data:\r\n\
Reply from 4.1.1.1: Destination net unreachable.\r\n\
\r\n\
Ping statistics for 192.0.2.1:\r\n\
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n";
        assert_eq!(count_echo_replies_from_target("192.0.2.1", stdout), 0);
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
        assert_eq!(count_echo_replies_from_target("10.231.255.1", stdout), 1);
        assert_eq!(parse_rtt_ms(stdout), Some(12.0));
        assert_eq!(classify_ping_counts(1, 1), "reachable");
    }

    #[test]
    fn multi_packet_intermittent_and_reachable() {
        assert_eq!(classify_ping_counts(4, 0), "unreachable");
        assert_eq!(classify_ping_counts(4, 1), "intermittent");
        assert_eq!(classify_ping_counts(4, 2), "intermittent");
        assert_eq!(classify_ping_counts(4, 3), "reachable"); // 75%
        assert_eq!(classify_ping_counts(4, 4), "reachable");
        assert_eq!(classify_ping_counts(8, 5), "intermittent"); // 62.5%
        assert_eq!(classify_ping_counts(8, 6), "reachable"); // 75%
    }

    #[test]
    fn counts_multiple_echo_replies() {
        let stdout = "\
Reply from 10.0.0.1: bytes=32 time=1ms TTL=64\r\n\
Reply from 10.0.0.1: bytes=32 time=2ms TTL=64\r\n\
Reply from 10.255.0.1: TTL expired in transit.\r\n\
Request timed out.\r\n";
        assert_eq!(count_echo_replies_from_target("10.0.0.1", stdout), 2);
    }

    #[test]
    fn partial_loss_does_not_false_negative_on_lost_equals_one() {
        // Multi-packet with Lost = 1 must still count real echoes
        let stdout = "\
Reply from 10.0.0.1: bytes=32 time=1ms TTL=64\r\n\
Reply from 10.0.0.1: bytes=32 time=2ms TTL=64\r\n\
Reply from 10.0.0.1: bytes=32 time=3ms TTL=64\r\n\
Request timed out.\r\n\
Ping statistics for 10.0.0.1:\r\n\
    Packets: Sent = 4, Received = 3, Lost = 1 (25% loss),\r\n";
        assert_eq!(count_echo_replies_from_target("10.0.0.1", stdout), 3);
        assert_eq!(classify_ping_counts(4, 3), "reachable");
    }
}
