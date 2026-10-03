from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"


def load_config(path=CONFIG_PATH):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_regions(regions, path=CONFIG_PATH):
    """Update only the `regions` block so comments elsewhere stay intact."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    out = []
    skipping = False
    for line in lines:
        if skipping and line.startswith("  "):
            continue
        skipping = False
        out.append(line)
        if line.startswith("regions:"):
            skipping = True
            for name, (x, y, w, h) in regions.items():
                out.append(f"  {name}: [{x}, {y}, {w}, {h}]")
    Path(path).write_text("\n".join(out) + "\n", encoding="utf-8")


def load_routine(path):
    path = Path(path)
    if not path.is_absolute():
        path = ROOT / path
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)
