/** อ่านค่า config จาก .env ทั้งหมดไว้ที่เดียว */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  // Node >= 20.6 โหลด .env ได้เอง ไม่ต้องพึ่ง dotenv
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);
  else require('dotenv').config({ path: envPath });
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|y|on)$/i.test(String(value).trim());
}

function list(value) {
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),

  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    allowedSourceIds: list(process.env.LINE_ALLOWED_SOURCE_IDS),
  },

  boxTareKg: Number(process.env.BOX_TARE_KG ?? 1),
  customsLineMode: (process.env.CUSTOMS_LINE_MODE || 'box').toLowerCase(),

  dhl: {
    mode: (process.env.DHL_MODE || 'web').toLowerCase(),
    api: {
      base: (process.env.DHL_API_BASE || 'https://express.api.dhl.com/mydhlapi').replace(/\/$/, ''),
      username: process.env.DHL_API_USERNAME || '',
      password: process.env.DHL_API_PASSWORD || '',
      accountNumber: process.env.DHL_ACCOUNT_NUMBER || '',
      productCode: process.env.DHL_PRODUCT_CODE || 'P',
      labelFormat: (process.env.DHL_LABEL_FORMAT || 'PDF').toUpperCase(),
      incoterm: process.env.DHL_INCOTERM || 'DAP',
      unitOfMeasurement: process.env.DHL_UNIT_OF_MEASUREMENT || 'metric',
      timezoneOffset: process.env.DHL_TZ_OFFSET || '+07:00',
      pickupRequested: bool(process.env.DHL_PICKUP_REQUESTED, false),
      labelTemplate: process.env.DHL_LABEL_TEMPLATE || 'ECOM26_84_A4_001',
    },
    web: {
      url: process.env.DHL_WEB_URL || 'https://mydhl.express.dhl/th/th/home.html',
      username: process.env.DHL_WEB_USERNAME || '',
      password: process.env.DHL_WEB_PASSWORD || '',
      headless: bool(process.env.DHL_WEB_HEADLESS, true),
      // true = กรอกทุกช่องให้ดู แต่ไม่กดยืนยัน (ไม่เกิด shipment ไม่เสียเงิน)
      dryRun: bool(process.env.DHL_DRY_RUN, false),
    },
  },

  shipper: {
    name: process.env.SHIPPER_NAME || '',
    company: process.env.SHIPPER_COMPANY || process.env.SHIPPER_NAME || '',
    phone: process.env.SHIPPER_PHONE || '',
    email: process.env.SHIPPER_EMAIL || '',
    addressLine1: process.env.SHIPPER_ADDRESS1 || '',
    addressLine2: process.env.SHIPPER_ADDRESS2 || '',
    city: process.env.SHIPPER_CITY || '',
    state: process.env.SHIPPER_STATE || '',
    postalCode: process.env.SHIPPER_POSTAL_CODE || '',
    countryCode: (process.env.SHIPPER_COUNTRY_CODE || 'TH').toUpperCase(),
  },

  print: {
    mode: (process.env.PRINT_MODE || 'cups').toLowerCase(),
    copies: Number(process.env.PRINT_COPIES || 1),
    cups: {
      printer: process.env.CUPS_PRINTER || '',
      host: process.env.CUPS_HOST || '',
      options: process.env.CUPS_OPTIONS || '',
    },
    printnode: {
      apiKey: process.env.PRINTNODE_API_KEY || '',
      printerId: process.env.PRINTNODE_PRINTER_ID || '',
    },
  },
};

module.exports = config;
