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
"$(dirname "$0")/scripts/clean-install.sh"

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
