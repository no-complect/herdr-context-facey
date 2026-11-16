#!/usr/bin/env python3
"""Read-only local session reader. The mod and this CLI use protocol version 1."""

import argparse
import json
from pathlib import Path

from reader.protocol import failure
from reader.service import handle


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        result = handle(args.request, Path.home())
    except Exception as error:
        # Contain defects without returning paths, transcript text or raw diagnostics.
        result = failure("reader_failed", "The local reader failed (" + type(error).__name__ + ").")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
