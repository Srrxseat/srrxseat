"""
แปลซับไทเทิล .srt จากภาษาอังกฤษ -> ภาษาไทย ด้วย Claude API

วิธีใช้:
  1) cd subtitle
  2) python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
  3) pip install -r requirements.txt
  4) คัดลอก .env.example -> .env แล้วใส่ ANTHROPIC_API_KEY
  5) python translate_srt.py movie.en.srt
     -> ได้ไฟล์ movie.en.th.srt

ตัวอย่างการใช้งานอื่น ๆ:
  # กำหนดชื่อไฟล์ผลลัพธ์เอง
  python translate_srt.py movie.en.srt -o หนัง_ไทย.srt

  # ซับสองภาษา (ไทยบรรทัดบน อังกฤษบรรทัดล่าง)
  python translate_srt.py movie.en.srt --mode bilingual

  # บอกบริบทของวิดีโอ ช่วยให้แปลตรงบริบทมากขึ้น
  python translate_srt.py movie.en.srt --context "สารคดีเกี่ยวกับการลงทุนหุ้น พูดกับผู้ชมทั่วไป"

  # ใช้ศัพท์เฉพาะ/คำแปลที่บังคับไว้ (ไฟล์ข้อความ บรรทัดละ 1 คู่: english = ไทย)
  python translate_srt.py movie.en.srt --glossary glossary.txt

  # ระดับความสุภาพ/โทน
  python translate_srt.py movie.en.srt --tone formal      # ทางการ (ครับ/ค่ะ)
  python translate_srt.py movie.en.srt --tone casual      # กันเอง (ค่าเริ่มต้น)

  # ตรวจไฟล์ก่อนแปล (ไม่เรียก API ไม่เสียเงิน)
  python translate_srt.py movie.en.srt --dry-run

หมายเหตุ:
  - เวลา (timecode) ทุกบรรทัดถูกคัดลอกมาตรงตัว ไม่มีการขยับ
  - จำนวน cue เข้า = จำนวน cue ออก เสมอ ถ้า cue ไหนแปลไม่ได้จะคงข้อความอังกฤษเดิมไว้
  - แปลเป็นชุด (batch) พร้อมส่งบทก่อน/หลังเป็นบริบท เพื่อให้สรรพนามและคำเรียกต่อเนื่องกัน
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
from pathlib import Path

from srt_parse import Cue, dump_srt, parse_srt

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # ไม่มี python-dotenv ก็ยังใช้ได้ ถ้า export env เอง
    pass

import anthropic

MODEL = "claude-opus-5"

TONE_HINT = {
    "casual": "โทนเป็นกันเอง เหมือนพูดคุยธรรมดา ใช้คำลงท้ายสุภาพเท่าที่จำเป็น",
    "formal": "โทนสุภาพทางการ ใช้คำลงท้าย ครับ/ค่ะ ตามความเหมาะสม",
    "neutral": "โทนกลาง ๆ ไม่ทางการและไม่กันเองเกินไป ตัดคำลงท้ายที่ไม่จำเป็นออก",
}

SYSTEM_PROMPT = """คุณเป็นนักแปลซับไทเทิลมืออาชีพ แปลจากภาษาอังกฤษเป็นภาษาไทย

กฎการแปล:
1. แปลให้เป็นภาษาไทยที่คนไทยพูดจริง ไม่ใช่แปลตรงตัวคำต่อคำ ห้ามใช้ภาษาแปล
2. แปล cue ละบรรทัดตามที่ได้รับ ต้องส่งคืน "ทุก" id ที่ได้รับ ครบถ้วน ห้ามรวบ ห้ามข้าม ห้ามเพิ่ม id ใหม่
3. หนึ่ง cue อยู่บนจอไม่กี่วินาที -> เก็บใจความให้สั้น กระชับ อ่านทันทีเข้าใจทันที
4. ประโยคที่ถูกตัดค้างไว้กลาง cue ให้แปลค้างไว้แบบเดียวกัน อย่าเติมประโยคให้จบเอง
5. รักษาแท็กจัดรูปแบบเดิมไว้ทุกตัว เช่น <i> </i> <b> {\\an8} และเครื่องหมาย - ที่ใช้แทนบทสนทนาสองคน
6. ชื่อคน ชื่อสถานที่ ชื่อแบรนด์ ให้ทับศัพท์ตามที่คนไทยเรียกกัน ถ้าไม่มีคำเรียกที่ใช้กันให้คงภาษาอังกฤษไว้
7. ตัวเลข หน่วยวัด และสกุลเงิน คงค่าเดิม (ไม่ต้องแปลงหน่วย) เขียนแบบที่คนไทยอ่านออก
8. คำหยาบ/คำสแลง แปลให้ได้ระดับความแรงใกล้เคียงต้นฉบับ ไม่ต้องเซ็นเซอร์เอง
9. เสียงประกอบหรือคำบรรยายในวงเล็บเหลี่ยม เช่น [MUSIC] [LAUGHTER] ให้แปลเป็นไทยในวงเล็บเหลี่ยมเหมือนกัน
10. ถ้าข้อความต้นฉบับมีหลายบรรทัด ให้จัดบรรทัดใหม่ตามความเหมาะสมของภาษาไทย ไม่เกิน 2 บรรทัดต่อ cue (คั่นด้วย \\n)
11. ห้ามใส่คำอธิบายหรือความคิดเห็นใด ๆ ลงในคำแปล ส่งคืนเฉพาะข้อความซับ"""


# ---------- glossary ----------
def load_glossary(path: Path) -> list[tuple[str, str]]:
    """อ่านไฟล์ศัพท์เฉพาะ รูปแบบบรรทัดละ: english = ไทย  (ขึ้นต้น # = คอมเมนต์)"""
    pairs: list[tuple[str, str]] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for sep in ("=", "\t", "|", ":"):
            if sep in line:
                en, th = line.split(sep, 1)
                if en.strip() and th.strip():
                    pairs.append((en.strip(), th.strip()))
                break
    return pairs


# ---------- batching ----------
def make_batches(cues: list[Cue], size: int) -> list[list[Cue]]:
    return [cues[i : i + size] for i in range(0, len(cues), size)]


def build_user_message(
    batch: list[Cue],
    before: list[Cue],
    after: list[Cue],
    context: str | None,
    glossary: list[tuple[str, str]],
    tone: str,
    max_chars: int,
) -> str:
    parts: list[str] = []

    if context:
        parts.append(f"บริบทของวิดีโอ: {context}")

    if glossary:
        terms = "\n".join(f"- {en} = {th}" for en, th in glossary)
        parts.append(f"คำแปลที่บังคับใช้ (ต้องใช้ตามนี้เท่านั้น):\n{terms}")

    parts.append(f"โทนการแปล: {TONE_HINT.get(tone, TONE_HINT['casual'])}")
    parts.append(f"ความยาวต่อบรรทัด: พยายามไม่เกินประมาณ {max_chars} ตัวอักษร")

    if before:
        prev = "\n".join(c.text.replace("\n", " ") for c in before)
        parts.append(f"บทก่อนหน้า (บริบทเท่านั้น ห้ามแปลส่วนนี้):\n{prev}")

    payload = [{"id": c.index, "text": c.text} for c in batch]
    parts.append(
        "ซับที่ต้องแปล (JSON):\n"
        + json.dumps(payload, ensure_ascii=False, indent=1)
    )

    if after:
        nxt = "\n".join(c.text.replace("\n", " ") for c in after)
        parts.append(f"บทถัดไป (บริบทเท่านั้น ห้ามแปลส่วนนี้):\n{nxt}")

    ids = [c.index for c in batch]
    parts.append(
        f"ส่งคืนคำแปลไทยของ id เหล่านี้ให้ครบทั้ง {len(ids)} รายการ: {ids}"
    )
    return "\n\n".join(parts)


RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "translations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "th": {"type": "string"},
                },
                "required": ["id", "th"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["translations"],
    "additionalProperties": False,
}


def call_claude(client: anthropic.Anthropic, user_message: str) -> dict[int, str]:
    response = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": RESULT_SCHEMA},
        },
        messages=[{"role": "user", "content": user_message}],
    )

    if response.stop_reason == "refusal":
        detail = getattr(response.stop_details, "explanation", "") or ""
        raise RuntimeError(f"โมเดลปฏิเสธคำขอ: {detail}")

    text = next((b.text for b in response.content if b.type == "text"), "")
    data = json.loads(text)
    return {int(item["id"]): item["th"] for item in data["translations"]}


def translate_batch(
    client: anthropic.Anthropic,
    batch: list[Cue],
    before: list[Cue],
    after: list[Cue],
    args: argparse.Namespace,
    glossary: list[tuple[str, str]],
    depth: int = 0,
) -> dict[int, str]:
    """แปลหนึ่ง batch ถ้าคำแปลขาด id ไปจะแบ่งครึ่งแล้วลองใหม่"""
    message = build_user_message(
        batch, before, after, args.context, glossary, args.tone, args.max_chars
    )
    try:
        result = call_claude(client, message)
    except Exception as exc:  # noqa: BLE001 -- ล้มแล้วต้องไปต่อให้ครบไฟล์
        print(f"  ! batch {batch[0].index}-{batch[-1].index} ผิดพลาด: {exc}", file=sys.stderr)
        result = {}

    missing = [c for c in batch if not result.get(c.index, "").strip()]
    if missing and len(batch) > 1 and depth < 3:
        print(
            f"  ~ ขาด {len(missing)} cue ในช่วง {batch[0].index}-{batch[-1].index} "
            f"-> แบ่งครึ่งแล้วลองใหม่",
            file=sys.stderr,
        )
        mid = len(batch) // 2
        for half in (batch[:mid], batch[mid:]):
            result.update(
                translate_batch(client, half, before, after, args, glossary, depth + 1)
            )
    elif missing:
        print(
            f"  ! ยังขาด {len(missing)} cue -> คงข้อความอังกฤษเดิมไว้",
            file=sys.stderr,
        )

    return result


# ---------- ประกอบไฟล์ผลลัพธ์ ----------
def tidy(text: str) -> str:
    """เก็บกวาดคำแปล: ตัดช่องว่างซ้ำ ตัดบรรทัดเกิน 2 บรรทัด"""
    text = text.replace("\\n", "\n").strip()
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln]
    if len(lines) > 2:
        lines = [" ".join(lines[: len(lines) // 2]), " ".join(lines[len(lines) // 2 :])]
    return "\n".join(lines)


def build_output(
    cues: list[Cue], translations: dict[int, str], mode: str
) -> list[Cue]:
    out: list[Cue] = []
    for cue in cues:
        th = tidy(translations.get(cue.index, ""))
        en = cue.text.strip()

        if not th:
            body = en                              # แปลไม่ได้ -> คงต้นฉบับ
        elif mode == "thai":
            body = th
        elif mode == "bilingual":                  # ไทยบน อังกฤษล่าง
            body = f"{th}\n{en}" if en else th
        elif mode == "bilingual-en-first":         # อังกฤษบน ไทยล่าง
            body = f"{en}\n{th}" if en else th
        else:
            body = th

        out.append(Cue(index=cue.index, timing=cue.timing, lines=body.split("\n")))
    return out


def default_output_path(src: Path, mode: str) -> Path:
    suffix = ".th" if mode == "thai" else ".th-en"
    return src.with_suffix("").with_name(src.stem + suffix + ".srt")


def main() -> int:
    p = argparse.ArgumentParser(
        description="แปลไฟล์ซับไทเทิล .srt จากอังกฤษเป็นไทยด้วย Claude",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input", type=Path, help="ไฟล์ .srt ภาษาอังกฤษ")
    p.add_argument("-o", "--output", type=Path, help="ไฟล์ผลลัพธ์ (ค่าเริ่มต้น: <ชื่อไฟล์>.th.srt)")
    p.add_argument(
        "--mode",
        choices=["thai", "bilingual", "bilingual-en-first"],
        default="thai",
        help="thai = ไทยเท่านั้น (ค่าเริ่มต้น), bilingual = ไทยบน/อังกฤษล่าง, bilingual-en-first = อังกฤษบน/ไทยล่าง",
    )
    p.add_argument("--tone", choices=list(TONE_HINT), default="casual", help="โทนการแปล")
    p.add_argument("--context", help="อธิบายว่าวิดีโอเกี่ยวกับอะไร ใครพูด เพื่อให้แปลตรงบริบท")
    p.add_argument("--glossary", type=Path, help="ไฟล์ศัพท์เฉพาะ บรรทัดละ: english = ไทย")
    p.add_argument("--batch-size", type=int, default=40, help="จำนวน cue ต่อการเรียก API 1 ครั้ง (ค่าเริ่มต้น 40)")
    p.add_argument("--context-cues", type=int, default=6, help="จำนวน cue ก่อน/หลัง ที่ส่งไปเป็นบริบท")
    p.add_argument("--workers", type=int, default=4, help="จำนวน batch ที่แปลพร้อมกัน (ค่าเริ่มต้น 4)")
    p.add_argument("--max-chars", type=int, default=42, help="ความยาวสูงสุดต่อบรรทัดโดยประมาณ")
    p.add_argument("--dry-run", action="store_true", help="แค่ตรวจไฟล์ ไม่เรียก API")
    args = p.parse_args()

    if not args.input.exists():
        print(f"ไม่พบไฟล์: {args.input}", file=sys.stderr)
        return 1

    cues = parse_srt(args.input.read_text(encoding="utf-8-sig", errors="replace"))
    if not cues:
        print("อ่านไฟล์ไม่พบ cue เลย -- ไฟล์อาจไม่ใช่ .srt", file=sys.stderr)
        return 1

    print(f"อ่าน {args.input} ได้ {len(cues)} cue")

    batches = make_batches(cues, max(1, args.batch_size))
    if args.dry_run:
        print(f"จะเรียก API {len(batches)} ครั้ง (batch ละ {args.batch_size} cue)")
        print("--- ตัวอย่าง 3 cue แรก ---")
        for c in cues[:3]:
            print(f"[{c.index}] {c.timing}\n{c.text}\n")
        return 0

    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        print(
            "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY -- คัดลอก .env.example เป็น .env แล้วใส่ค่า "
            "หรือ export ANTHROPIC_API_KEY=... ก่อนรัน",
            file=sys.stderr,
        )
        return 1

    glossary = load_glossary(args.glossary) if args.glossary else []
    if glossary:
        print(f"ใช้ศัพท์เฉพาะ {len(glossary)} คำจาก {args.glossary}")

    client = anthropic.Anthropic(max_retries=4)
    ctx = max(0, args.context_cues)
    translations: dict[int, str] = {}

    def work(bi: int) -> dict[int, str]:
        batch = batches[bi]
        start = batch[0].index - 1
        end = batch[-1].index
        before = cues[max(0, start - ctx) : start] if ctx else []
        after = cues[end : end + ctx] if ctx else []
        out = translate_batch(client, batch, before, after, args, glossary)
        print(f"  แปลแล้ว {batch[0].index}-{batch[-1].index} ({len(out)} cue)")
        return out

    print(f"กำลังแปล {len(batches)} batch ด้วย {args.workers} thread ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for result in pool.map(work, range(len(batches))):
            translations.update(result)

    done = sum(1 for c in cues if translations.get(c.index, "").strip())
    out_path = args.output or default_output_path(args.input, args.mode)
    out_path.write_text(dump_srt(build_output(cues, translations, args.mode)), encoding="utf-8")

    print(f"\nเสร็จแล้ว: {out_path}")
    print(f"แปลสำเร็จ {done}/{len(cues)} cue" + ("" if done == len(cues) else " (ที่เหลือคงข้อความอังกฤษเดิม)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
