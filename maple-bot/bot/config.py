from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"


def load_config(path=CONFIG_PATH):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_block(name, values, path=CONFIG_PATH):
    """Rewrite one top-level block of list values (e.g. `regions` or
    `player_dot_hsv`) in place so comments elsewhere stay intact."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    out = []
    skipping = False
    for line in lines:
        if skipping and line.startswith("  "):
            continue
        skipping = False
        out.append(line)
        if line.startswith(f"{name}:"):
            skipping = True
            for key, items in values.items():
                out.append(f"  {key}: [{', '.join(str(int(v)) for v in items)}]")
    Path(path).write_text("\n".join(out) + "\n", encoding="utf-8")


def load_routine(path):
    path = Path(path)
    if not path.is_absolute():
        path = ROOT / path
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)
