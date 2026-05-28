"""
FlowAccount - อัปเดตข้อมูลธนาคารของ Contacts จาก Google Sheet (Selenium)

วิธีใช้:
  1) cd selenium
  2) python -m venv .venv && source .venv/bin/activate   # หรือ .venv\Scripts\activate บน Windows
  3) pip install -r requirements.txt
  4) คัดลอก .env.example -> .env แล้วใส่ email/password ของ FlowAccount
  5) ตรวจสอบว่า Google Sheet share = "ใครก็ตามที่มีลิงก์ดูได้"
  6) python update_bank.py

หมายเหตุ:
  - เปิด Chrome แบบมีหน้าจอ (ไม่ headless) เผื่อมี 2FA / CAPTCHA
  - Selector เป็นการเดาแบบ best-effort -- ถ้า UI FlowAccount เปลี่ยน
    แก้ตรง class SELECTORS ด้านล่างได้เลย
"""

import csv
import io
import os
import sys
import time
import urllib.request

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

load_dotenv()

# ---------- CONFIG ----------
SHEET_ID = "1CR5T5XnyFSIT1r2q-XKuxowOk4IiQTl_dLVM0aJe-vs"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"
CONTACTS_URL = "https://advance.flowaccount.com/N4236690/business/contacts"
LOGIN_URL = "https://flowaccount.com/login"

EMAIL = os.getenv("FLOWACCOUNT_EMAIL")
PASSWORD = os.getenv("FLOWACCOUNT_PASSWORD")

BRANCH_CODE = "0000"
BRANCH_NAME = "-"
ACCOUNT_TYPE = "ออมทรัพย์"


# ---------- SELECTORS (แก้ตรงนี้ถ้า UI FlowAccount เปลี่ยน) ----------
class SELECTORS:
    LOGIN_EMAIL = (By.CSS_SELECTOR, 'input[type="email"], input[name="email"], input[name="username"]')
    LOGIN_PASSWORD = (By.CSS_SELECTOR, 'input[type="password"], input[name="password"]')
    LOGIN_SUBMIT = (By.XPATH, '//button[@type="submit" or contains(., "เข้าสู่ระบบ") or contains(., "Login")]')

    CONTACT_SEARCH = (By.CSS_SELECTOR, 'input[type="search"], input[placeholder*="ค้นหา"], input[placeholder*="Search"]')

    EDIT_BUTTON = (By.XPATH, '//button[contains(., "แก้ไข")] | //a[contains(., "แก้ไข")]')
    BANK_TAB = (By.XPATH, '//*[self::button or self::a or @role="tab"][contains(., "ข้อมูลธนาคาร") or contains(., "บัญชีธนาคาร")]')
    ADD_BANK_BUTTON = (By.XPATH, '//button[contains(., "เพิ่มบัญชีธนาคาร") or normalize-space()="เพิ่ม"]')

    BANK_NAME_FIELD = (By.CSS_SELECTOR, 'input[name*="bankName"], input[placeholder*="ธนาคาร"], [aria-label*="ธนาคาร"]')
    ACCOUNT_NAME_FIELD = (By.CSS_SELECTOR, 'input[name*="accountName"], input[placeholder*="ชื่อบัญชี"]')
    ACCOUNT_NUMBER_FIELD = (By.CSS_SELECTOR, 'input[name*="accountNumber"], input[placeholder*="เลขที่บัญชี"]')
    BRANCH_CODE_FIELD = (By.CSS_SELECTOR, 'input[name*="branchCode"], input[placeholder*="รหัสสาขา"]')
    BRANCH_NAME_FIELD = (By.CSS_SELECTOR, 'input[name*="branchName"], input[placeholder*="ชื่อสาขา"]')
    ACCOUNT_TYPE_FIELD = (By.CSS_SELECTOR, 'select[name*="accountType"], [aria-label*="ประเภทบัญชี"], input[placeholder*="ประเภทบัญชี"]')

    SAVE_AND_CLOSE = (By.XPATH, '//button[contains(., "บันทึกแล้วปิด")]')


# ---------- HELPERS ----------
def fetch_csv(url: str) -> list[list[str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} - ตรวจสอบว่า Sheet share = Anyone with the link")
        data = resp.read().decode("utf-8", errors="replace")
    return list(csv.reader(io.StringIO(data)))


def safe_fill(driver, by_selector, value: str, timeout: int = 8):
    el = WebDriverWait(driver, timeout).until(EC.visibility_of_element_located(by_selector))
    el.click()
    el.send_keys(Keys.CONTROL, "a")
    el.send_keys(Keys.DELETE)
    el.clear()
    el.send_keys(value)
    return el


def pick_bank(driver, bank_name: str, timeout: int = 8):
    el = WebDriverWait(driver, timeout).until(EC.visibility_of_element_located(SELECTORS.BANK_NAME_FIELD))
    el.click()
    el.clear()
    el.send_keys(bank_name)
    time.sleep(0.8)
    try:
        option = driver.find_element(
            By.XPATH,
            f'//*[(@role="option" or self::li)][contains(., "{bank_name}")]',
        )
        option.click()
    except Exception:
        # อาจจะเป็น input ธรรมดา ไม่มี dropdown
        pass


def pick_account_type(driver, label: str, timeout: int = 8):
    el = WebDriverWait(driver, timeout).until(EC.visibility_of_element_located(SELECTORS.ACCOUNT_TYPE_FIELD))
    if el.tag_name.lower() == "select":
        Select(el).select_by_visible_text(label)
        return
    el.click()
    time.sleep(0.4)
    try:
        option = driver.find_element(
            By.XPATH,
            f'//*[(@role="option" or self::li)][contains(., "{label}")]',
        )
        option.click()
    except Exception:
        el.clear()
        el.send_keys(label)


def click_if_present(driver, by_selector, timeout: int = 3) -> bool:
    try:
        el = WebDriverWait(driver, timeout).until(EC.element_to_be_clickable(by_selector))
        el.click()
        return True
    except Exception:
        return False


# ---------- MAIN ----------
def main() -> int:
    if not EMAIL or not PASSWORD:
        print("ERROR: ตั้งค่า FLOWACCOUNT_EMAIL และ FLOWACCOUNT_PASSWORD ใน .env", file=sys.stderr)
        return 1

    print("โหลด Google Sheet...")
    rows = fetch_csv(CSV_URL)
    if len(rows) < 2:
        print("Sheet ว่างหรืออ่านไม่ได้", file=sys.stderr)
        return 1

    records = []
    for r in rows[1:]:
        # ขยาย row ให้ยาวพอ
        r = r + [""] * (20 - len(r))
        account_name = (r[0] or "").strip()       # Column A
        bank_name = (r[17] or "").strip()         # Column R
        account_number = (r[18] or "").strip()    # Column S
        if account_name and bank_name and account_number:
            records.append((account_name, bank_name, account_number))

    print(f"เจอ {len(records)} รายการที่มีข้อมูลธนาคารครบ")

    opts = Options()
    opts.add_argument("--lang=th-TH")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    driver = webdriver.Chrome(options=opts)
    driver.maximize_window()
    wait = WebDriverWait(driver, 30)

    try:
        # -- LOGIN --
        print("กำลัง login FlowAccount...")
        driver.get(LOGIN_URL)
        try:
            safe_fill(driver, SELECTORS.LOGIN_EMAIL, EMAIL, timeout=15)
            safe_fill(driver, SELECTORS.LOGIN_PASSWORD, PASSWORD, timeout=5)
            driver.find_element(*SELECTORS.LOGIN_SUBMIT).click()
        except Exception:
            print("Auto-login อาจไม่สำเร็จ — login เองได้ในหน้าต่างที่เปิดอยู่")

        print("รอเข้าสู่ระบบเสร็จ (รวม 2FA ถ้ามี)... สูงสุด 3 นาที")
        WebDriverWait(driver, 180).until(lambda d: "flowaccount.com/N" in d.current_url)

        ok, failed = [], []
        for account_name, bank_name, account_number in records:
            print(f"\n→ {account_name} | {bank_name} | {account_number}")
            try:
                driver.get(CONTACTS_URL)
                search = wait.until(EC.visibility_of_element_located(SELECTORS.CONTACT_SEARCH))
                search.click()
                search.clear()
                search.send_keys(account_name)
                time.sleep(1.5)

                # คลิก row แรกที่ตรงชื่อ
                target = wait.until(EC.element_to_be_clickable((
                    By.XPATH,
                    f'(//tr[contains(., "{account_name}")] | //*[@role="row"][contains(., "{account_name}")] | //a[contains(., "{account_name}")])[1]',
                )))
                target.click()
                time.sleep(1.0)

                click_if_present(driver, SELECTORS.EDIT_BUTTON, timeout=4)
                click_if_present(driver, SELECTORS.BANK_TAB, timeout=4)
                click_if_present(driver, SELECTORS.ADD_BANK_BUTTON, timeout=2)

                pick_bank(driver, bank_name)
                safe_fill(driver, SELECTORS.ACCOUNT_NAME_FIELD, account_name)
                safe_fill(driver, SELECTORS.ACCOUNT_NUMBER_FIELD, account_number)
                safe_fill(driver, SELECTORS.BRANCH_CODE_FIELD, BRANCH_CODE)
                safe_fill(driver, SELECTORS.BRANCH_NAME_FIELD, BRANCH_NAME)
                pick_account_type(driver, ACCOUNT_TYPE)

                driver.find_element(*SELECTORS.SAVE_AND_CLOSE).click()
                time.sleep(1.5)
                print("  ✓ บันทึกแล้ว")
                ok.append(account_name)
            except Exception as exc:
                print(f"  ✗ ล้มเหลว: {exc}")
                failed.append((account_name, str(exc)))
                try:
                    driver.save_screenshot(f"error_{int(time.time())}.png")
                except Exception:
                    pass

        print("\n========== สรุป ==========")
        print(f"สำเร็จ: {len(ok)}")
        print(f"ล้มเหลว: {len(failed)}")
        for name, err in failed:
            print(f"  - {name}: {err}")
    finally:
        driver.quit()

    return 0


if __name__ == "__main__":
    sys.exit(main())
