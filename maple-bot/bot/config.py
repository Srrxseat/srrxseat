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


def _save_routine(path, routine):
    text = yaml.safe_dump(routine, allow_unicode=True, sort_keys=False, default_flow_style=None)
    path.write_text(ROUTINE_HEADER.split("loop:")[0] + text, encoding="utf-8")


def append_routine_step(path, point, attack_times=8, loot_times=3, keys=None):
    """Add a step at `point` to the routine file, creating it if needed.

    `keys` are the key presses recorded while walking here from the previous
    point; patrol mode replays them to get between points reliably."""
    path = routine_path(path)
    try:
        routine = load_routine(path)
    except RoutineError:
        # Keep the broken file for reference and start a fresh one.
        path.replace(path.with_suffix(".broken.yaml"))
        routine = {"loop": True, "steps": []}
    step = {
        "point": [round(point[0], 3), round(point[1], 3)],
        "actions": [{"attack": {"times": attack_times}}, {"loot": {"times": loot_times}}],
    }
    if keys:
        step["path"] = keys
    routine["steps"].append(step)
    _save_routine(path, routine)
    return len(routine["steps"])


def set_closing_path(path, keys):
    """Keys recorded walking from the last point back to the first one."""
    path = routine_path(path)
    routine = load_routine(path)
    routine["closing_path"] = keys
    _save_routine(path, routine)


def clear_routine(path):
    routine_path(path).write_text(ROUTINE_HEADER, encoding="utf-8")
