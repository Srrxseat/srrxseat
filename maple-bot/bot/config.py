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


def routine_path(path):
    path = Path(path)
    return path if path.is_absolute() else ROOT / path


class RoutineError(Exception):
    pass


def load_routine(path):
    path = routine_path(path)
    if not path.exists():
        return {"loop": True, "steps": []}
    try:
        with open(path, encoding="utf-8") as f:
            routine = yaml.safe_load(f) or {"loop": True, "steps": []}
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        where = f" แถวบรรทัด {mark.line + 1}" if mark else ""
        raise RoutineError(f"ไฟล์ {path.name} รูปแบบผิด{where}") from e
    if not isinstance(routine, dict) or not isinstance(routine.get("steps") or [], list):
        raise RoutineError(f"ไฟล์ {path.name} รูปแบบผิด (ต้องมี steps: เป็นรายการจุด)")
    routine.setdefault("steps", [])
    routine["steps"] = routine["steps"] or []
    return routine


ROUTINE_HEADER = """# บันทึกอัตโนมัติด้วย F8 - แก้ได้ (times = จำนวนครั้งที่ตี/เก็บของ)
# direction: left หรือ right = หันไปทางนั้นก่อนตี (ลบออกได้ถ้าไม่ต้องการ)
loop: true
steps:
"""


def append_routine_step(path, point, attack_times=8, loot_times=3):
    """Add a step at `point` to the routine file, creating it if needed."""
    path = routine_path(path)
    try:
        load_routine(path)
        broken = False
    except RoutineError:
        broken = True
    if broken:
        # Keep the broken file for reference and start a fresh one.
        path.replace(path.with_suffix(".broken.yaml"))
    if not path.exists() or "steps:" not in path.read_text(encoding="utf-8"):
        path.write_text(ROUTINE_HEADER, encoding="utf-8")
    with open(path, "a", encoding="utf-8") as f:
        f.write(
            f"  - point: [{point[0]:.3f}, {point[1]:.3f}]\n"
            f"    actions:\n"
            f"      - attack: {{times: {attack_times}}}\n"
            f"      - loot: {{times: {loot_times}}}\n"
        )
    return len(load_routine(path)["steps"])


def clear_routine(path):
    routine_path(path).write_text(ROUTINE_HEADER, encoding="utf-8")
