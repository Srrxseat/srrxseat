"""ส่งข้อความแจ้งเตือนเข้า Telegram

ใช้เป็นไลบรารี:
    from notify import send
    send("งานอัปเดตธนาคารเสร็จแล้ว ✅")

ใช้เป็นคำสั่ง CLI:
    python notify.py "ข้อความที่ต้องการส่ง"
    echo "ข้อความ" | python notify.py
    python notify.py --file report.png "แนบรูปด้วย"

ต้องตั้งค่าใน .env (ดู .env.example):
    TELEGRAM_BOT_TOKEN=...
    TELEGRAM_CHAT_ID=...
"""

import argparse
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API_BASE = "https://api.telegram.org"
TIMEOUT = 30


class TelegramError(RuntimeError):
    pass


def _config(token=None, chat_id=None):
    token = token or os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID")
    if not token:
        raise TelegramError("ไม่พบ TELEGRAM_BOT_TOKEN (ตั้งค่าในไฟล์ .env)")
    if not chat_id:
        raise TelegramError("ไม่พบ TELEGRAM_CHAT_ID (รัน `python bot.py --whoami` เพื่อหา chat id)")
    return token, chat_id


def _call(token, method, *, data=None, files=None):
    resp = requests.post(
        f"{API_BASE}/bot{token}/{method}", data=data, files=files, timeout=TIMEOUT
    )
    try:
        payload = resp.json()
    except ValueError:
        raise TelegramError(f"Telegram ตอบกลับไม่ใช่ JSON (HTTP {resp.status_code})")
    if not payload.get("ok"):
        raise TelegramError(
            f"Telegram ปฏิเสธคำขอ {method}: {payload.get('description', payload)}"
        )
    return payload["result"]


def send(text, *, token=None, chat_id=None, parse_mode="HTML", silent=False):
    """ส่งข้อความ (รองรับ HTML tags เช่น <b>ตัวหนา</b>, <code>โค้ด</code>)"""
    token, chat_id = _config(token, chat_id)
    return _call(
        token,
        "sendMessage",
        data={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
            # ส่งเฉพาะตอน True — Telegram ตีความสตริง "False" เป็นค่าจริง
            **({"disable_notification": True} if silent else {}),
        },
    )


def send_file(path, caption=None, *, token=None, chat_id=None, silent=False):
    """ส่งไฟล์แนบ (รูปภาพจะส่งเป็น photo, ที่เหลือส่งเป็น document)"""
    token, chat_id = _config(token, chat_id)
    path = Path(path)
    if not path.is_file():
        raise TelegramError(f"ไม่พบไฟล์: {path}")

    is_photo = path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    method = "sendPhoto" if is_photo else "sendDocument"
    field = "photo" if is_photo else "document"

    data = {"chat_id": chat_id}
    if silent:
        data["disable_notification"] = True
    if caption:
        data["caption"] = caption
        data["parse_mode"] = "HTML"

    with path.open("rb") as fh:
        return _call(token, method, data=data, files={field: (path.name, fh)})


def main():
    parser = argparse.ArgumentParser(description="ส่งข้อความแจ้งเตือนเข้า Telegram")
    parser.add_argument("text", nargs="*", help="ข้อความ (ถ้าไม่ใส่จะอ่านจาก stdin)")
    parser.add_argument("--file", "-f", help="ไฟล์ที่ต้องการแนบ")
    parser.add_argument("--chat-id", help="ระบุ chat id เฉพาะครั้งนี้")
    parser.add_argument("--plain", action="store_true", help="ไม่ตีความ HTML")
    parser.add_argument("--silent", action="store_true", help="ส่งแบบไม่เด้งเสียงแจ้งเตือน")
    args = parser.parse_args()

    text = " ".join(args.text).strip()
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read().strip()

    try:
        if args.file:
            send_file(args.file, text or None, chat_id=args.chat_id, silent=args.silent)
        elif text:
            send(
                text,
                chat_id=args.chat_id,
                parse_mode=None if args.plain else "HTML",
                silent=args.silent,
            )
        else:
            parser.error("ต้องระบุข้อความ หรือ --file อย่างน้อยหนึ่งอย่าง")
    except (TelegramError, requests.RequestException) as exc:
        print(f"ส่งไม่สำเร็จ: {exc}", file=sys.stderr)
        return 1

    print("ส่งเรียบร้อย ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
