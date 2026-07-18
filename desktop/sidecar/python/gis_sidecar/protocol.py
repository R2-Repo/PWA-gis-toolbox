"""Newline-delimited JSON protocol for the GIS Toolbox sidecar."""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Iterable, Optional


PROTOCOL_VERSION = 1


def read_request(stream=None) -> Optional[Dict[str, Any]]:
    stream = stream or sys.stdin
    line = stream.readline()
    if not line:
        return None
    line = line.strip()
    if not line:
        return None
    return json.loads(line)


def write_message(message: Dict[str, Any], stream=None) -> None:
    stream = stream or sys.stdout
    stream.write(json.dumps(message, separators=(",", ":"), ensure_ascii=True))
    stream.write("\n")
    stream.flush()


def emit_progress(request_id: str, *, percent: Optional[float] = None, stage: str = "", message: str = "") -> None:
    payload: Dict[str, Any] = {"id": request_id, "type": "progress"}
    if percent is not None:
        payload["percent"] = percent
    if stage:
        payload["stage"] = stage
    if message:
        payload["message"] = message
    write_message(payload)


def emit_log(request_id: str, message: str) -> None:
    write_message({"id": request_id, "type": "log", "message": message})


def emit_result(request_id: str, output: Any) -> None:
    write_message({"id": request_id, "type": "result", "ok": True, "output": output})


def emit_error(request_id: str, message: str, details: Any = None) -> None:
    payload: Dict[str, Any] = {
        "id": request_id,
        "type": "result",
        "ok": False,
        "message": message,
    }
    if details is not None:
        payload["details"] = details
    write_message(payload)


def iter_requests(stream=None) -> Iterable[Dict[str, Any]]:
    while True:
        req = read_request(stream)
        if req is None:
            break
        yield req
