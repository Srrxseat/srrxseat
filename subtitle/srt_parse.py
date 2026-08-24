"""
ตัวช่วยอ่าน/เขียนไฟล์ซับไทเทิล .srt

- อ่านไฟล์ .srt ที่มี BOM / CRLF / ลำดับเลขเพี้ยน ได้แบบทนทาน
- เก็บ timecode เดิมไว้ทั้งบรรทัด (ไม่แตะต้อง) เพื่อไม่ให้เวลาเพี้ยน
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# 00:00:01,000 --> 00:00:04,500   (บางไฟล์ใช้จุดแทนลูกน้ำ / มี position ต่อท้าย)
TIME_RE = re.compile(
    r"^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})(.*)$"
)


@dataclass
class Cue:
    index: int                     # ลำดับที่จะเขียนออก (นับใหม่ 1..n)
    timing: str                    # บรรทัดเวลาแบบดิบ
    lines: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def parse_srt(raw: str) -> list[Cue]:
    """แปลงข้อความ .srt เป็นลิสต์ของ Cue"""
    raw = raw.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    lines = raw.split("\n")

    cues: list[Cue] = []
    i = 0
    n = len(lines)
    while i < n:
        # ข้ามบรรทัดว่าง
        if not lines[i].strip():
            i += 1
            continue

        # บรรทัดนี้อาจเป็นเลขลำดับ หรือเป็น timecode เลยก็ได้
        if TIME_RE.match(lines[i]):
            timing = lines[i].strip()
            i += 1
        elif i + 1 < n and TIME_RE.match(lines[i + 1]):
            timing = lines[i + 1].strip()
            i += 2
        else:
            # บรรทัดขยะ -- ข้ามไป
            i += 1
            continue

        body: list[str] = []
        while i < n and lines[i].strip():
            # เจอ block ถัดไปที่ไม่มีบรรทัดว่างคั่น
            if TIME_RE.match(lines[i]):
                break
            if (
                lines[i].strip().isdigit()
                and i + 1 < n
                and TIME_RE.match(lines[i + 1])
            ):
                break
            body.append(lines[i].rstrip())
            i += 1

        cues.append(Cue(index=len(cues) + 1, timing=timing, lines=body))

    return cues


def normalize_timing(timing: str) -> str:
    """บังคับให้ใช้ลูกน้ำเป็นตัวคั่นมิลลิวินาที (มาตรฐาน SRT) และเติมเลข 0 ให้ครบ"""
    m = TIME_RE.match(timing)
    if not m:
        return timing

    def fix(t: str) -> str:
        t = t.replace(".", ",")
        head, ms = t.split(",")
        h, mm, ss = head.split(":")
        return f"{int(h):02d}:{mm}:{ss},{ms.ljust(3, '0')[:3]}"

    tail = m.group(3).rstrip()
    return f"{fix(m.group(1))} --> {fix(m.group(2))}{tail}"


def dump_srt(cues: list[Cue]) -> str:
    """เขียนกลับเป็นข้อความ .srt (ลงท้ายด้วยบรรทัดว่างตามมาตรฐาน)"""
    blocks = []
    for k, cue in enumerate(cues, start=1):
        body = cue.text.strip("\n") or ""
        blocks.append(f"{k}\n{normalize_timing(cue.timing)}\n{body}\n")
    return "\n".join(blocks)
