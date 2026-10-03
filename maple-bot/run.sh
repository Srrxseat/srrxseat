#!/bin/bash
# Run the bot (or a tool) inside its own virtualenv, creating/updating it as needed.
#   bash run.sh                      -> python main.py
#   bash run.sh tools/check.py keys  -> python tools/check.py keys
set -e
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
    echo "[setup] สร้าง .venv (ครั้งแรกใช้เวลาสักครู่)..."
    python3 -m venv .venv
fi
# Reinstall whenever requirements.txt changes (e.g. after downloading a new version).
if ! cmp -s requirements.txt .venv/installed-requirements.txt; then
    echo "[setup] ติดตั้ง/อัปเดตโปรแกรมที่ต้องใช้..."
    .venv/bin/python -m pip install -q --upgrade pip
    .venv/bin/python -m pip install -r requirements.txt
    cp requirements.txt .venv/installed-requirements.txt
fi

if [ $# -eq 0 ]; then
    set -- main.py
fi
exec .venv/bin/python "$@"
