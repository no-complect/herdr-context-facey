"""Import the copyable mod package without installing it into the test environment."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "mods/herdr-context-facey"))
