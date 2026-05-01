#!/usr/bin/env bash
# clean-install.sh — remove any prior jupyterlab-cell-layout install state
# Usage: ./scripts/clean-install.sh
#
# Editable installs that have been rebuilt drift apart from pip's RECORD
# manifest (the labextension's hashed filenames change between builds), and
# subsequent installs fail with "No such file or directory" errors trying
# to remove the old hashed files. Same applies if a previous install was
# interrupted, or if you are upgrading from a `pip install -e .` checkout
# to a wheel from PyPI / GitHub.
#
# This script is safe to run repeatedly. It does NOT install anything —
# run `pip install ...` (or `./install.sh`) afterwards.

set -euo pipefail

pip uninstall jupyterlab_cell_layout -y >/dev/null 2>&1 || true

python3 <<'PY' || true
import shutil
from pathlib import Path
try:
    from jupyter_core.paths import jupyter_path
except ImportError:
    raise SystemExit(0)
NAME = "jupyterlab-cell-layout"
for base in jupyter_path():
    p = Path(base) / "labextensions" / NAME
    if p.is_symlink():
        try:
            p.unlink()
            print(f"  removed symlink: {p}")
        except OSError:
            pass
    elif p.exists():
        shutil.rmtree(p, ignore_errors=True)
        print(f"  removed dir:     {p}")
PY
