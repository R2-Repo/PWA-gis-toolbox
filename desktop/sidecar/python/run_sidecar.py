#!/usr/bin/env python3
"""Packaging entrypoint for PyInstaller / direct execution."""

from gis_sidecar.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
