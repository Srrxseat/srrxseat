"""บอทฝั่งรับข้อความ — ใช้หา chat id และตอบคำสั่งพื้นฐาน

    python bot.py --whoami   # ทักบอทใน Telegram ก่อน แล้วรันคำสั่งนี้เพื่อดู chat id
    python bot.py            # รันบอทค้างไว้ ตอบ /start /id /ping

ต้องตั้งค่า TELEGRAM_BOT_TOKEN ใน .env
"""

import argparse
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API_BASE = "https://api.telegram.org"
POLL_TIMEOUT = 30


def _token():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        sys.exit("ไม่พบ TELEGRAM_BOT_TOKEN (ตั้งค่าในไฟล์ .env)")
    return token


def _api(token, method, **params):
    resp = requests.get(
        f"{API_BASE}/bot{token}/{method}", params=params, timeout=POLL_TIMEOUT + 10
    )
    payload = resp.json()
    if not payload.get("ok"):
        sys.exit(f"Telegram ปฏิเสธคำขอ {method}: {payload.get('description', payload)}")
    return payload["result"]


def _describe(chat):
    name = chat.get("title") or " ".join(
        filter(None, [chat.get("first_name"), chat.get("last_name")])
    )
    handle = f"@{chat['username']}" if chat.get("username") else ""
    return f"{chat['id']}  [{chat['type']}]  {name} {handle}".strip()


def whoami(token):
    """แสดง chat id ทั้งหมดที่เคยคุยกับบอท (ต้องทักบอทก่อน)"""
    updates = _api(token, "getUpdates", timeout=0)
    chats = {}
    for update in updates:
        message = update.get("message") or update.get("channel_post")
        if message:
            chats[message["chat"]["id"]] = message["chat"]

    if not chats:
        print(
            "ยังไม่พบข้อความเข้ามา — เปิด Telegram ทักบอทด้วย /start ก่อน "
            "(ถ้าใช้ในกลุ่ม ให้เชิญบอทเข้ากลุ่มแล้วพิมพ์อะไรก็ได้) แล้วรันใหม่อีกครั้ง\n"
            "หมายเหตุ: ถ้าเคยรัน `python bot.py` ค้างไว้ ข้อความเก่าจะถูกอ่านไปแล้ว"
        )
        return

    print("เจอ chat ต่อไปนี้ — เอา id ไปใส่ TELEGRAM_CHAT_ID ใน .env")
    for chat in chats.values():
        print("  " + _describe(chat))


def run(token):
    """รันบอทค้างไว้ ตอบคำสั่งพื้นฐาน"""
    me = _api(token, "getMe")
    print(f"บอท @{me['username']} พร้อมทำงานแล้ว (กด Ctrl+C เพื่อหยุด)")

    offset = None
    while True:
        try:
            updates = _api(token, "getUpdates", offset=offset, timeout=POLL_TIMEOUT)
        except requests.RequestException as exc:
            print(f"เชื่อมต่อไม่ได้ ลองใหม่: {exc}", file=sys.stderr)
            continue

        for update in updates:
            offset = update["update_id"] + 1
            message = update.get("message")
            if not message:
                continue

            chat = message["chat"]
            text = (message.get("text") or "").strip()
            command = text.split()[0].split("@")[0].lower() if text else ""

            if command == "/start":
                reply = (
                    "สวัสดีครับ 👋 ผมเป็นบอทแจ้งเตือน\n\n"
                    f"chat id ของห้องนี้คือ <code>{chat['id']}</code>\n"
                    "เอาไปใส่ <code>TELEGRAM_CHAT_ID</code> ในไฟล์ .env "
                    "แล้วสคริปต์จะส่งแจ้งเตือนเข้ามาที่นี่ได้เลย\n\n"
                    "คำสั่ง: /id  /ping"
                )
            elif command == "/id":
                reply = f"chat id: <code>{chat['id']}</code>"
            elif command == "/ping":
                reply = "pong 🏓"
            else:
                continue

            requests.post(
                f"{API_BASE}/bot{token}/sendMessage",
                data={"chat_id": chat["id"], "text": reply, "parse_mode": "HTML"},
                timeout=30,
            )
            print(f"ตอบ {command} ให้ {_describe(chat)}")


def main():
    parser = argparse.ArgumentParser(description="บอท Telegram สำหรับแจ้งเตือน")
    parser.add_argument(
        "--whoami", action="store_true", help="แสดง chat id ที่เคยคุยกับบอท แล้วจบ"
    )
    args = parser.parse_args()

    token = _token()
    try:
        whoami(token) if args.whoami else run(token)
    except KeyboardInterrupt:
        print("\nหยุดบอทแล้ว")


if __name__ == "__main__":
    main()
