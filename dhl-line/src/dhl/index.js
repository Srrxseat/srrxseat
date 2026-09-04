/** เลือก adapter ของ DHL ตาม DHL_MODE */
const { DhlApiClient } = require('./apiClient');
const { MyDhlFlow } = require('./mydhlFlow');

function createDhlClient(config) {
  const mode = config.dhl.mode;
  if (mode === 'api') return new DhlApiClient(config);
  if (mode === 'web') return new MyDhlFlow(config);
  throw new Error(`DHL_MODE ไม่ถูกต้อง: ${mode} (ใช้ได้: api, web)`);
}

module.exports = { createDhlClient };
