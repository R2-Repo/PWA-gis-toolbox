use crate::sidecar::{run_sidecar_request, sleep_ms, SidecarState};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

const ALLOWED_OPS: &[&str] = &[
    "echo",
    "summarize_geojson",
    "inspect_vector",
    "sample_vector",
    "file_checksum",
    "convert_to_geoparquet",
    "convert_to_cog",
    "summarize_vector",
    "generate_pmtiles",
    "buffer_vector",
    "clip_vector",
    "spatial_join",
    "reproject_vector",
    "spatial_filter",
    "nearest_join",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStartRequest {
    pub client_job_id: String,
    pub operation: String,
    pub input: Value,
}

#[derive(Default)]
pub struct JobRegistry {
    cancel_flags: Mutex<HashMap<String, bool>>,
}

impl JobRegistry {
    pub fn mark_cancel(&self, job_id: &str) {
        if let Ok(mut map) = self.cancel_flags.lock() {
            map.insert(job_id.to_string(), true);
        }
    }

    pub fn is_canceled(&self, job_id: &str) -> bool {
        self.cancel_flags
            .lock()
            .ok()
            .and_then(|map| map.get(job_id).copied())
            .unwrap_or(false)
    }

    pub fn clear(&self, job_id: &str) {
        if let Ok(mut map) = self.cancel_flags.lock() {
            map.remove(job_id);
        }
    }
}

fn validate_operation(operation: &str, input: &Value) -> Result<(), String> {
    if !ALLOWED_OPS.contains(&operation) {
        return Err(format!("Operation \"{operation}\" is not allow-listed"));
    }
    if matches!(
        operation,
        "summarize_geojson"
            | "inspect_vector"
            | "sample_vector"
            | "file_checksum"
            | "convert_to_geoparquet"
            | "convert_to_cog"
            | "summarize_vector"
            | "generate_pmtiles"
            | "buffer_vector"
            | "clip_vector"
            | "spatial_join"
            | "reproject_vector"
            | "spatial_filter"
            | "nearest_join"
    ) {
        let path = input
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{operation} requires input.path"))?;
        if path.trim().is_empty() {
            return Err(format!("{operation} input.path must be non-empty"));
        }
    }
    if operation == "clip_vector" {
        let clip = input
            .get("clipPath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "clip_vector requires input.clipPath".to_string())?;
        if clip.trim().is_empty() {
            return Err("clip_vector input.clipPath must be non-empty".into());
        }
    }
    if operation == "spatial_join" || operation == "nearest_join" {
        let right = input
            .get("rightPath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{operation} requires input.rightPath"))?;
        if right.trim().is_empty() {
            return Err(format!("{operation} input.rightPath must be non-empty"));
        }
    }
    if operation == "buffer_vector" {
        if input.get("distance").and_then(|v| v.as_f64()).is_none()
            && input.get("distance").and_then(|v| v.as_i64()).is_none()
        {
            return Err("buffer_vector requires input.distance".into());
        }
    }
    if operation == "spatial_filter" {
        let has_area = input.get("areaPath").and_then(|v| v.as_str()).is_some()
            || input.get("areaGeojson").is_some();
        if !has_area {
            return Err("spatial_filter requires input.areaPath or input.areaGeojson".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn job_start(
    app: AppHandle,
    jobs: State<'_, Arc<JobRegistry>>,
    request: JobStartRequest,
) -> Result<Value, String> {
    validate_operation(&request.operation, &request.input)?;
    let job_id = request.client_job_id.clone();
    let operation = request.operation.clone();
    let input = request.input.clone();
    let registry = Arc::clone(&jobs);
    let response_job_id = job_id.clone();

    registry.clear(&job_id);

    std::thread::spawn(move || {
        if registry.is_canceled(&job_id) {
            let _ = app.emit(
                "sidecar-job-finished",
                json!({
                    "jobId": job_id,
                    "operation": operation,
                    "ok": false,
                    "canceled": true,
                    "message": "Job canceled before start"
                }),
            );
            return;
        }

        let _ = app.emit(
            "sidecar-job-progress",
            json!({
                "jobId": job_id,
                "percent": 1,
                "stage": "queued",
                "message": "Starting sidecar"
            }),
        );

        match run_sidecar_request(&operation, input, &job_id) {
            Ok(messages) => {
                let mut finished = false;
                for msg in messages {
                    if registry.is_canceled(&job_id) {
                        let _ = app.emit(
                            "sidecar-job-finished",
                            json!({
                                "jobId": job_id,
                                "operation": operation,
                                "ok": false,
                                "canceled": true,
                                "message": "Job canceled"
                            }),
                        );
                        finished = true;
                        break;
                    }

                    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match msg_type {
                        "progress" => {
                            let _ = app.emit(
                                "sidecar-job-progress",
                                json!({
                                    "jobId": job_id,
                                    "percent": msg.get("percent"),
                                    "stage": msg.get("stage"),
                                    "message": msg.get("message")
                                }),
                            );
                        }
                        "log" => {
                            let _ = app.emit(
                                "sidecar-job-log",
                                json!({
                                    "jobId": job_id,
                                    "message": msg.get("message").and_then(|v| v.as_str()).unwrap_or("")
                                }),
                            );
                        }
                        "result" => {
                            let ok = msg.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                            if ok {
                                let _ = app.emit(
                                    "sidecar-job-finished",
                                    json!({
                                        "jobId": job_id,
                                        "operation": operation,
                                        "ok": true,
                                        "canceled": false,
                                        "output": msg.get("output").cloned().unwrap_or(Value::Null)
                                    }),
                                );
                            } else {
                                let _ = app.emit(
                                    "sidecar-job-finished",
                                    json!({
                                        "jobId": job_id,
                                        "operation": operation,
                                        "ok": false,
                                        "canceled": false,
                                        "message": msg.get("message").and_then(|v| v.as_str()).unwrap_or("Sidecar failed"),
                                        "details": msg.get("details").cloned().unwrap_or(Value::Null)
                                    }),
                                );
                            }
                            finished = true;
                        }
                        _ => {}
                    }
                }

                if !finished {
                    let _ = app.emit(
                        "sidecar-job-finished",
                        json!({
                            "jobId": job_id,
                            "operation": operation,
                            "ok": false,
                            "canceled": false,
                            "message": "Sidecar ended without a result message"
                        }),
                    );
                }
            }
            Err(err) => {
                let _ = app.emit(
                    "sidecar-job-finished",
                    json!({
                        "jobId": job_id,
                        "operation": operation,
                        "ok": false,
                        "canceled": registry.is_canceled(&job_id),
                        "message": err
                    }),
                );
            }
        }

        registry.clear(&job_id);
        // Small delay helps ensure event flush ordering on some hosts.
        sleep_ms(1);
    });

    Ok(json!({ "jobId": response_job_id }))
}

#[tauri::command]
pub fn job_cancel(jobs: State<'_, Arc<JobRegistry>>, job_id: String) -> Result<Value, String> {
    jobs.mark_cancel(&job_id);
    Ok(json!({ "jobId": job_id, "cancelRequested": true }))
}

#[tauri::command]
pub fn sidecar_health(state: State<'_, SidecarState>) -> Result<Value, String> {
    let health = crate::sidecar::check_sidecar_health(&state);
    Ok(json!({
        "available": health.available,
        "version": health.version,
        "reason": health.reason,
        "operations": health.operations
    }))
}
