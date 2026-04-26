#!/usr/bin/env bash
# install.sh — install jupyterlab-cell-layout as a development extension
# Usage: ./install.sh
#
# Prerequisites (checked below): python3, pip, node, jupyter
#
# This runs an editable pip install (which triggers the TypeScript/webpack
# build via hatch-jupyter-builder) and registers the extension with the
# currently-active JupyterLab installation.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "Missing required command: $1"
    red "Please install it and re-run this script."
    exit 1
  fi
}

blue "Checking prerequisites..."
require python3
require pip
require node
require jupyter

py_version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
node_version=$(node --version)
jl_version=$(jupyter lab --version 2>/dev/null || echo "unknown")

echo "  Python:     ${py_version}"
echo "  Node:       ${node_version}"
echo "  JupyterLab: ${jl_version}"
echo

blue "Cleaning any previous install..."
# Editable installs that have been rebuilt drift apart from pip's RECORD
# manifest (the labextension's hashed filenames change between builds), and
# subsequent `pip install -e .` runs fail with "No such file or directory"
# errors trying to remove the old hashed files. Same applies if a previous
# install was interrupted. Running uninstall + nuking the labextension
# share-dir up-front makes this script safely re-runnable.
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

blue "Installing the Python package (editable)..."
pip install --editable .

blue "Registering the labextension for development..."
jupyter labextension develop . --overwrite

echo
green "✓ jupyterlab-cell-layout installed."
echo
echo "Verify:"
echo "  jupyter labextension list | grep cell-layout"
echo
echo "Run:"
echo "  jupyter lab"
echo
echo "Open a notebook, then press Ctrl+Shift+T to toggle summary mode."
