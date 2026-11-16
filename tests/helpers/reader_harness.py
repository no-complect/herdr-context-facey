"""Run the actual CLI against a temporary home; never inspect developer sessions."""

import runpy
import sys
from pathlib import Path
from unittest.mock import patch

entry, test_home, request = sys.argv[1:]
sys.path.insert(0, str(Path(entry).parent))
sys.argv = [entry, "--request", request]
with patch.object(Path, "home", return_value=Path(test_home)):
    runpy.run_path(entry, run_name="__main__")
