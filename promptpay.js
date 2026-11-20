'use strict';
// สร้างข้อความสำหรับ QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR Payment)

const PROMPTPAY_AID = 'A000000677010111';

function field(id, value) {
  return id + String(value.length).padStart(2, '0') + value;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF)
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// แปลงหมายเลขพร้อมเพย์เป็นรูปแบบในมาตรฐาน คืน null ถ้าไม่ถูกต้อง
function normalizeTarget(id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length === 15) return { tag: '03', value: digits, kind: 'ewallet' };
  if (digits.length === 13) return { tag: '02', value: digits, kind: 'national_id' };
  if (digits.length === 10 && digits.startsWith('0')) {
    return { tag: '01', value: '0066' + digits.slice(1), kind: 'phone' };
  }
  if (digits.length === 11 && digits.startsWith('66')) {
    return { tag: '01', value: '00' + digits, kind: 'phone' };
  }
  return null;
}

function promptPayPayload(id, amount) {
  const target = normalizeTarget(id);
  if (!target) throw new Error('หมายเลขพร้อมเพย์ไม่ถูกต้อง');
  const hasAmount = amount != null && Number(amount) > 0;
  const data =
    field('00', '01') +
    field('01', hasAmount ? '12' : '11') +
    field('29', field('00', PROMPTPAY_AID) + field(target.tag, target.value)) +
    field('58', 'TH') +
    field('53', '764') +
    (hasAmount ? field('54', Number(amount).toFixed(2)) : '') +
    '6304';
  return data + crc16(data);
}

module.exports = { promptPayPayload, normalizeTarget, crc16 };
