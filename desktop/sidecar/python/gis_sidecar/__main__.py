"""CLI entry: python -m gis_sidecar

Reads one newline-delimited JSON request from stdin and writes progress/result lines.
"""

from __future__ import annotations

import sys
import traceback

from .operations import dispatch
from .protocol import emit_error, emit_result, read_request


def main() -> int:
    try:
        request = read_request()
    except Exception as exc:  # noqa: BLE001 - surface protocol errors to host
        emit_error("unknown", f"Invalid request JSON: {exc}")
        return 2

    if request is None:
        emit_error("unknown", "Empty request")
        return 2

    request_id = str(request.get("id") or "unknown")
    operation = request.get("op") or request.get("operation")
    input_data = request.get("input") or {}

    if not operation or not isinstance(operation, str):
        emit_error(request_id, 'Request requires string field "op"')
        return 2

    if not isinstance(input_data, dict):
        emit_error(request_id, 'Request field "input" must be an object')
        return 2

    try:
        output = dispatch(request_id, operation, input_data)
        emit_result(request_id, output)
        return 0
    except Exception as exc:  # noqa: BLE001
        emit_error(
            request_id,
            str(exc),
            details={"traceback": traceback.format_exc(limit=4)},
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
