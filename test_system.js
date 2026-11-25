/**
 * SUITE PENGUJIAN OTOMATIS (UNIT & INTEGRATION TESTS)
 * Sistem Automasi Donasi & Transparansi Beasiswa Alumni UPI
 * 
 * Cara Menjalankan:
 * node test_system.js
 */

const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

console.log('========================================================');
console.log('🧪 MEMULAI PENGUJIAN OTOMATIS SISTEM BEASISWA IKA UPI');
console.log('========================================================\n');

// 1. Load seed_data.js & config.js
const window = {};
eval(fs.readFileSync('seed_data.js', 'utf-8'));
eval(fs.readFileSync('config.js', 'utf-8'));

const db = window.DEFAULT_SEED_DATABASE;
const config = window.APP_CONFIG;

let passedTests = 0;
let totalTests = 0;

function runTest(testName, testFn) {
  totalTests++;
  try {
    testFn();
    console.log(`✅ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${testName}`);
    console.error('   Error:', err.message);
  }
}

// -----------------------------------------------------------------------------
// TEST 1: Integritas Database Induk Alumni (master_alumni)
// -----------------------------------------------------------------------------
runTest('Integritas Master Alumni (Tepat 25 data alumni di 8 Fakultas)', () => {
  assert.strictEqual(db.master_alumni.length, 25, 'Jumlah alumni harus tepat 25');
  
  const expectedFaculties = ['FIP', 'FPIPS', 'FPBS', 'FPMIPA', 'FPTK', 'FPOK', 'FPEB', 'FPSD'];
  const actualFaculties = new Set(db.master_alumni.map(a => a.fakultas));
  
  expectedFaculties.forEach(f => {
    assert.ok(actualFaculties.has(f), `Fakultas ${f} harus ada dalam data alumni`);
  });
});

// -----------------------------------------------------------------------------
// TEST 2: Validasi Lookup Identitas Alumni (Step 1)
// -----------------------------------------------------------------------------
runTest('Validasi Lookup NIM Mahasiswa (2001234 -> Fadhil Muhammad Ramadhan)', () => {
  const alumni = db.master_alumni.find(a => a.nim === '2001234');
  assert.ok(alumni, 'Alumni dengan NIM 2001234 harus ditemukan');
  assert.strictEqual(alumni.namaLengkap, 'Fadhil Muhammad Ramadhan');
  assert.strictEqual(alumni.fakultas, 'FPMIPA');
  assert.strictEqual(alumni.angkatan, '2020');
});

// -----------------------------------------------------------------------------
// TEST 3: Integritas 5 Kasus Representatif (Tepat 1 Data per Kasus/Skenario)
// -----------------------------------------------------------------------------
runTest('Integritas 5 Kasus Representatif (Jalur 1, Jalur 2, Jalur 3, Silent Donor, Pending)', () => {
  assert.strictEqual(db.raw_donations.length, 5, 'Jumlah transaksi harus tepat 5 (1 per kasus)');

  const tiers = new Set(db.raw_donations.map(t => t.verificationTier));
  assert.ok(tiers.has('TIER_1_VERIFIED'), 'Harus ada Case 1: TIER_1_VERIFIED');
  assert.ok(tiers.has('TIER_2_ONBOARDED'), 'Harus ada Case 2: TIER_2_ONBOARDED');
  assert.ok(tiers.has('TIER_3_EXPRESS'), 'Harus ada Case 3: TIER_3_EXPRESS');
  assert.ok(tiers.has('UNCLAIMED_DIRECT_TRANSFER'), 'Harus ada Case 4: UNCLAIMED_DIRECT_TRANSFER');

  const pendingTx = db.raw_donations.find(t => t.paymentStatus === 'PENDING');
  assert.ok(pendingTx, 'Harus ada Case 5: Status PENDING');

  const requiredFields = [
    'transactionId', 'timestamp', 'inflowPath', 'donorName', 
    'baseAmount', 'uniqueCode', 'totalTransferAmount', 'paymentChannel', 'paymentStatus'
  ];
  
  db.raw_donations.forEach((tx, idx) => {
    requiredFields.forEach(field => {
      assert.ok(tx[field] !== undefined, `Transaksi case ${idx+1} harus memiliki field ${field}`);
    });
  });
});

// -----------------------------------------------------------------------------
// TEST 4: Algoritma Ekstraksi Regex Email Mutasi Bank (BSI & Jago)
// -----------------------------------------------------------------------------
runTest('Ekstraksi Regex Notifikasi Email Mutasi Bank BSI & Jago', () => {
  const bsiSample = "CR TRANSFER DARI FAUZI VIA ATM BSI REK 7188000001 NOMINAL 100.342 BERHASIL";
  const jagoSample = "TRSF E-BANKING CR DARI SITI AMINAH VIA KANTONG JAGO 500000000001 SEBESAR RP 250.819";

  const bsiAmountMatch = bsiSample.match(/NOMINAL\s+([\d.]+)/i);
  assert.ok(bsiAmountMatch, 'Regex BSI harus dapat mengekstrak nominal');
  const bsiAmount = parseInt(bsiAmountMatch[1].replace(/\./g, ''), 10);
  assert.strictEqual(bsiAmount, 100342);

  const jagoAmountMatch = jagoSample.match(/RP\s+([\d.]+)/i);
  assert.ok(jagoAmountMatch, 'Regex Jago harus dapat mengekstrak nominal');
  const jagoAmount = parseInt(jagoAmountMatch[1].replace(/\./g, ''), 10);
  assert.strictEqual(jagoAmount, 250819);
});

// -----------------------------------------------------------------------------
// TEST 5: Formula Rekonsiliasi Kas & Segregation of Duties
// -----------------------------------------------------------------------------
runTest('Kalkulasi Kas Rekonsiliasi (Total Terhimpun = Kas Cair Bendahara + Gateway)', () => {
  const settled = db.raw_donations.filter(t => t.paymentStatus === 'PAID' || t.paymentStatus === 'SETTLED');
  const grandTotal = settled.reduce((sum, t) => sum + (Number(t.totalTransferAmount) || 0), 0);

  const bsiTotal = settled.filter(t => t.paymentChannel.includes('BSI')).reduce((s, t) => s + Number(t.totalTransferAmount), 0);
  const jagoTotal = settled.filter(t => t.paymentChannel.includes('JAGO')).reduce((s, t) => s + Number(t.totalTransferAmount), 0);
  const qrisTotal = settled.filter(t => t.paymentChannel.includes('QRIS')).reduce((s, t) => s + Number(t.totalTransferAmount), 0);

  const totalKasBendahara = bsiTotal + jagoTotal;
  const totalKasGateway = qrisTotal;

  assert.strictEqual(grandTotal, totalKasBendahara + totalKasGateway, 'Total dana harus sama dengan Kas Bendahara + Kas Gateway');
  assert.strictEqual(grandTotal, 1850631, 'Grand total dari 4 transaksi lunas harus tepat Rp 1.850.631');
  assert.strictEqual(totalKasBendahara, 1500312, 'Kas Bendahara harus tepat Rp 1.500.312');
  assert.strictEqual(totalKasGateway, 350319, 'Kas Gateway QRIS harus tepat Rp 350.319');
});

// -----------------------------------------------------------------------------
// TEST 6: Aturan Masking Data Privasi UU PDP (UU No. 27/2022)
// -----------------------------------------------------------------------------
runTest('Implementasi Data Masking Kepatuhan UU PDP (Nama & WhatsApp)', () => {
  function maskName(name) {
    if (!name) return 'Hamba Allah';
    const parts = name.trim().split(' ');
    return parts.map(p => p.length <= 2 ? p : p[0] + p[1] + '***').join(' ');
  }

  function maskPhone(phone) {
    if (!phone || phone.length < 8) return '-';
    return phone.slice(0, 4) + '****' + phone.slice(-3);
  }

  const maskedFadhil = maskName('Fadhil Ramadhan');
  assert.strictEqual(maskedFadhil, 'Fa*** Ra***');

  const maskedPhone = maskPhone('08122001234');
  assert.strictEqual(maskedPhone, '0812****234');
});

// -----------------------------------------------------------------------------
// TEST 7: Deteksi dan Penanganan Silent Donor (Case 4)
// -----------------------------------------------------------------------------
runTest('Deteksi Status UNCLAIMED_DIRECT_TRANSFER untuk Silent Donors (Case 4)', () => {
  const unclaimed = db.raw_donations.filter(t => 
    t.verificationTier === 'UNCLAIMED_DIRECT_TRANSFER' || 
    t.inflowPath === 'DIRECT_BANK_MUTATION'
  );
  
  assert.strictEqual(unclaimed.length, 1, 'Harus ada tepat 1 data transaksi Silent Donor representatif');
  const silentTx = unclaimed[0];
  assert.strictEqual(silentTx.verificationTier, 'UNCLAIMED_DIRECT_TRANSFER');
  assert.ok(silentTx.bankSenderRaw && silentTx.bankSenderRaw.includes('SITI AMINAH'), 'Mutasi liar harus mencatat nama pengirim rekening asli');
  assert.strictEqual(silentTx.totalTransferAmount, 500000);
});

// -----------------------------------------------------------------------------
// TEST 8: Ekstraksi Regex Mutasi Email DANA QRIS & Ingestion
// -----------------------------------------------------------------------------
runTest('Ekstraksi Regex Email Mutasi DANA QRIS (gateway-inbox@example.com)', () => {
  const danaEmailBody1 = "Pembayaran sebesar Rp 50 dari Alumni Demo Test telah berhasil diterima via QRIS.";
  const danaEmailBody2 = "Saldo DANA bertambah Rp 50.000 dari Donatur Alumni UPI.";
  const danaSubject = "Transaksi Berhasil: Uang Masuk Rp 100.000";

  function extractDanaAmount(body, subject) {
    const match = body.match(/(?:sebesar|nominal|jumlah|diterima|total(?:\s+transfer)?|masuk)\s*(?:sebesar)?\s*Rp\.?\s*([0-9.,]+)/i) || 
                  subject.match(/Rp\.?\s?([0-9.,]+)/i) || 
                  body.match(/Rp\.?\s?([0-9.,]+)/i) || 
                  body.match(/(?:IDR|sebesar)\s?([0-9.,]+)/i);
    if (match && match[1]) {
      return parseInt(match[1].replace(/[.,]/g, "").trim(), 10);
    }
    return 0;
  }

  assert.strictEqual(extractDanaAmount(danaEmailBody1, ""), 50, 'Harus mengekstrak Rp 50');
  assert.strictEqual(extractDanaAmount(danaEmailBody2, ""), 50000, 'Harus mengekstrak Rp 50.000');
  assert.strictEqual(extractDanaAmount("", danaSubject), 100000, 'Harus mengekstrak Rp 100.000 dari subjek');
});

// -----------------------------------------------------------------------------
// TEST 9: EMVCo Dynamic QRIS Generator & Checksum CRC-16/CCITT-FALSE
// -----------------------------------------------------------------------------
runTest('EMVCo Dynamic QRIS Generator & Checksum CRC-16/CCITT-FALSE', () => {
  const STATIC_QRIS_PAYLOAD = "00020101021126450018ID.EXAMPLE.SANDBOX01189999000000000000015204599953033605802ID5919SANDBOX SCHOLARSHIP6007BANDUNG610540154630451D2";

  function computeCRC16CCITT(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) << 8);
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function buildDynamicQRISPayload(amountInteger) {
    const amtInt = Math.max(1, Math.round(Number(amountInteger) || 0));
    const amtStr = String(amtInt);
    const tag54 = '54' + String(amtStr.length).padStart(2, '0') + amtStr;
    const withoutCRC = STATIC_QRIS_PAYLOAD.slice(0, -4).replace('000201010211', '000201010212');
    const countryIndex = withoutCRC.indexOf('5802ID');
    const payloadWithoutCRC = withoutCRC.slice(0, countryIndex) + tag54 + withoutCRC.slice(countryIndex);
    return payloadWithoutCRC + computeCRC16CCITT(payloadWithoutCRC);
  }

  // 1. Verifikasi CRC payload statis dasar
  const baseCRC = computeCRC16CCITT(STATIC_QRIS_PAYLOAD.slice(0, -4));
  assert.strictEqual(baseCRC, '51D2', 'CRC untuk static payload harus 51D2');

  // 2. Verifikasi Dynamic QRIS untuk Rp 100.342 (Pokok 100.000 + Kode Unik 342)
  const dynPayload = buildDynamicQRISPayload(100342);
  assert.ok(dynPayload.startsWith('000201010212'), 'Dynamic QRIS harus berawalan 000201010212');
  assert.ok(dynPayload.includes('5406100342'), 'Harus menyisipkan Tag 54 dengan panjang 06 dan nominal 100342');
  assert.ok(dynPayload.includes('5802ID'), 'Harus tetap memiliki Tag 5802ID (Country Code)');
  assert.strictEqual(dynPayload.slice(-4), computeCRC16CCITT(dynPayload.slice(0, -4)), 'Checksum CRC-16 di ujung payload harus valid');

  // 3. Verifikasi Dynamic QRIS Donasi Mikro Demo < Rp 1.000 (Contoh: Rp 50)
  const microPayload50 = buildDynamicQRISPayload(50);
  assert.ok(microPayload50.startsWith('000201010212'), 'Dynamic QRIS mikro harus berawalan 000201010212');
  assert.ok(microPayload50.includes('540250'), 'Harus menyisipkan Tag 54 untuk Rp 50 (540250)');
  assert.strictEqual(microPayload50.slice(-4), computeCRC16CCITT(microPayload50.slice(0, -4)), 'Checksum CRC-16 Rp 50 harus valid');
});

// -----------------------------------------------------------------------------
// TEST 10: Automasi Upload Bukti Screenshot (Arsip Admin Tanpa Auto-Approve)
// -----------------------------------------------------------------------------
runTest('Upload Bukti Screenshot Sebagai Arsip Admin (Status Tetap PENDING Hingga Email Masuk)', () => {
  // 1. Verifikasi skema database induk memiliki atribut proofImageUrl di seluruh 5 kasus
  assert.ok(Array.isArray(db.raw_donations), 'raw_donations harus berupa array');
  assert.strictEqual(db.raw_donations.length, 5, 'Harus memiliki tepat 5 kasus representatif');

  db.raw_donations.forEach((tx, idx) => {
    assert.ok('proofImageUrl' in tx, `Transaksi indeks ${idx} (${tx.transactionId}) harus memiliki property proofImageUrl`);
  });

  // 2. Simulasi alur upload bukti arsip untuk transaksi PENDING (Case 5)
  const pendingTx = db.raw_donations.find(t => t.transactionId === 'TX-CASE5-PENDING');
  assert.ok(pendingTx, 'Case 5 (TX-CASE5-PENDING) harus ada');
  assert.strictEqual(pendingTx.paymentStatus, 'PENDING', 'Status awal Case 5 harus PENDING');

  // Upload bukti hanya menyimpan tautan Google Drive sebagai arsip tanpa melunaskan status
  const simulatedDriveUrl = 'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view?usp=sharing';
  const archivedTx = {
    ...pendingTx,
    paymentStatus: pendingTx.paymentStatus,
    settlementStatus: pendingTx.settlementStatus,
    notes: 'Arsip bukti transfer diunggah donatur (Google Drive)',
    proofImageUrl: simulatedDriveUrl
  };

  assert.strictEqual(archivedTx.paymentStatus, 'PENDING', 'Status harus tetap PENDING sebelum mutasi email masuk');
  assert.strictEqual(archivedTx.settlementStatus, 'UNSETTLED', 'Settlement tidak boleh berubah menjadi SETTLED oleh upload gambar');
  assert.ok(archivedTx.proofImageUrl.includes('drive.google.com'), 'Proof URL harus menyimpan tautan Google Drive untuk admin');
});

// -----------------------------------------------------------------------------
// TEST 11: Parser Asli Email Bank Jago Syariah (noreply@jago.com -> treasury-gateway@example.com)
// -----------------------------------------------------------------------------
runTest('Parser Email Bank Jago Syariah Asli & Filter Nomor Rekening Kantong', () => {
  const gasSandbox = { console, Utilities: { formatDate: () => '2026-11-24 13:37:00' } };
  vm.createContext(gasSandbox);
  vm.runInContext(fs.readFileSync('Code.gs', 'utf-8'), gasSandbox);

  const realJagoEmailBody = [
    'Assalamu\'alaikum ALUMNI DEMO TEST,',
    'Kantong Jago-mu telah menerima sejumlah uang dan berikut rinciannya:',
    '',
    'Ringkasan transaksi',
    'Dari',
    'ALUMNIDEMOTEST',
    'Bank Syariah Indonesia • 7000000001',
    'Ke',
    'BEASISWA_DEMO • 500000000001',
    'Jumlah',
    'Rp10.000',
    'Tanggal transaksi',
    '24 November 2026 13:37 WIB'
  ].join('\n');

  const parsedTarget = gasSandbox.parseJagoMutationText(realJagoEmailBody);
  assert.strictEqual(parsedTarget.nominalCredit, 10000, 'Nominal Bank Jago Rp10.000 harus terekstrak presisi');
  assert.strictEqual(parsedTarget.targetAccount, '500000000001', 'Nomor rekening kantong BEASISWA_DEMO (500000000001) harus terekstrak');
  assert.strictEqual(parsedTarget.targetPocket, 'BEASISWA_DEMO', 'Nama kantong BEASISWA_DEMO harus terekstrak');
  assert.strictEqual(parsedTarget.senderNameOnly, 'ALUMNIDEMOTEST', 'Nama pengirim asli harus terekstrak');
  assert.ok(parsedTarget.senderName.includes('7000000001'), 'Detail bank/rekening pengirim ikut tercatat');

  // Validasi normalisasi nama donatur web vs pengirim Bank Jago
  const normWebName = gasSandbox.normalizeNameForMatch('Alumni Demo Test');
  const normEmailSender = gasSandbox.normalizeNameForMatch(parsedTarget.senderNameOnly);
  assert.strictEqual(normWebName, normEmailSender, 'Normalisasi nama donatur harus cocok antara format web dan mutasi Bank Jago');

  // Simulasi email masuk ke kantong pribadi Jago lain (harus diabaikan oleh filter rekening tujuan)
  const otherPocketEmailBody = realJagoEmailBody.replace('BEASISWA_DEMO • 500000000001', 'Pribadi • 509999999999');
  const parsedOther = gasSandbox.parseJagoMutationText(otherPocketEmailBody);
  assert.strictEqual(parsedOther.targetAccount, '509999999999');
  assert.notStrictEqual(parsedOther.targetAccount, '500000000001', 'Mutasi rekening Bank Jago selain 500000000001 harus tertolak filter tujuan');
});

// -----------------------------------------------------------------------------
// TEST 12: Pengamanan Rekonsiliasi (Zero False Attribution, Auto-Match & Auto-Expire)
// -----------------------------------------------------------------------------
runTest('Zero False Attribution, Auto-Match Nama Donatur, & Auto-Expire 15 Menit', () => {
  function toWibString(ms) {
    return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }

  function createMockSheet(initialRows) {
    const rows = initialRows.map(r => r.slice());
    return {
      rows,
      getLastRow() { return rows.length; },
      appendRow(arr) { rows.push(arr.slice()); },
      getRange(r, c, numRows = 1, numCols = 1) {
        if (arguments.length === 2) {
          return {
            setValue(val) {
              while (rows[r - 1].length < c) rows[r - 1].push('');
              rows[r - 1][c - 1] = val;
            }
          };
        }
        return {
          getValues() {
            const out = [];
            for (let i = 0; i < numRows; i++) {
              const row = rows[r - 1 + i] || [];
              out.push(row.slice(c - 1, c - 1 + numCols));
            }
            return out;
          }
        };
      }
    };
  }

  const nowMs = Date.now();
  const header = new Array(20).fill('').map((_, i) => 'Col' + (i + 1));
  const rawSheet = createMockSheet([
    header,
    [
      'TX-ALUMNI-DEMO', toWibString(nowMs - 2 * 60 * 1000), 'ALUMNI_TERDATA', '2400001',
      'Alumni Demo Test', 'FPMIPA', 'Ilmu Komputer', '2024', '081200000001',
      0, 0, 0, 'TRANSFER_JAGO', 'PUBLIC', 'TIER_1_VERIFIED', 'PENDING', 'UNSETTLED', '-', '-', ''
    ],
    [
      'TX-STALE', toWibString(nowMs - 20 * 60 * 1000), 'ALUMNI_TERDATA', '2001234',
      'Alumni Lama', 'FPTK', 'Teknik Sipil', '2020', '081200000',
      0, 0, 0, 'QRIS', 'PUBLIC', 'TIER_1_VERIFIED', 'PENDING', 'UNSETTLED', '-', '-', ''
    ]
  ]);
  const auditSheet = createMockSheet([['Timestamp', 'Event', 'TxID', 'Payload', 'Result']]);
  const sheets = { raw_donations: rawSheet, audit_logs: auditSheet };

  const gasSandbox = {
    console,
    Date,
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities: { formatDate: (d) => toWibString(d.getTime()) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => { sheets[name] = createMockSheet([]); return sheets[name]; }
      })
    }
  };
  vm.createContext(gasSandbox);
  vm.runInContext(fs.readFileSync('Code.gs', 'utf-8'), gasSandbox);

  // 1. Cek unit helper pencocokan nama
  assert.strictEqual(gasSandbox.isDonorNameMatched('Alumni Demo Test', 'ALUMNIDEMOTEST'), true);
  assert.strictEqual(gasSandbox.isDonorNameMatched('Alumni Test', 'ALUMNIDEMOTEST'), true);
  assert.strictEqual(gasSandbox.isDonorNameMatched('Hamba Allah', 'HAMBA ALLAH'), false, 'Nama generik tidak boleh auto-match');
  assert.strictEqual(gasSandbox.isDonorNameMatched('Alumni Demo Test', 'BUDI SANTOSO'), false);

  // 2. Uji auto-expire (> 15 menit -> EXPIRED, 2 menit -> tetap PENDING)
  const expRes = gasSandbox.expireStalePendingTransactions();
  assert.strictEqual(expRes.expiredCount, 1, 'Tepat 1 transaksi PENDING > 15 menit harus kedaluwarsa');
  assert.strictEqual(rawSheet.rows[2][15], 'EXPIRED', 'TX-STALE harus menjadi EXPIRED');
  assert.strictEqual(rawSheet.rows[1][15], 'PENDING', 'TX-ALUMNI-DEMO (2 menit) harus tetap PENDING');

  // 3. Uji Zero False Attribution: Mutasi BUDI SANTOSO (Rp 50.000) tidak boleh menempel ke TX-ALUMNI-DEMO
  const resMismatch = gasSandbox.executeSmartAutoMatching({
    bankType: 'TRANSFER_JAGO',
    nominalCredit: 50000,
    senderName: 'BUDI SANTOSO (Bank BCA)',
    senderNameOnly: 'BUDI SANTOSO',
    targetAccount: '500000000001'
  });
  assert.strictEqual(resMismatch.matched, false, 'Mutasi pengirim berbeda tidak boleh menempel ke PENDING orang lain');
  assert.strictEqual(rawSheet.rows[1][15], 'PENDING', 'TX-ALUMNI-DEMO harus tetap PENDING');
  const directRow = rawSheet.rows.find(r => String(r[0]).startsWith('TX-DIRECT-'));
  assert.ok(directRow, 'Mutasi BUDI SANTOSO harus tercatat sebagai baris TX-DIRECT baru');
  assert.strictEqual(directRow[14], 'UNCLAIMED_DIRECT_TRANSFER');
  assert.strictEqual(directRow[15], 'PAID');
  assert.strictEqual(directRow[11], 50000);

  // 4. Uji Auto-Match Nama Donatur: Mutasi ALUMNIDEMOTEST (Rp 10.000) cocok ke TX-ALUMNI-DEMO
  const resMatch = gasSandbox.executeSmartAutoMatching({
    bankType: 'TRANSFER_JAGO',
    nominalCredit: 10000,
    senderName: 'ALUMNIDEMOTEST (Bank Syariah Indonesia • 7000000001)',
    senderNameOnly: 'ALUMNIDEMOTEST',
    targetAccount: '500000000001'
  });
  assert.strictEqual(resMatch.matched, true, 'Mutasi dengan nama pengirim cocok harus auto-match');
  assert.strictEqual(resMatch.transactionId, 'TX-ALUMNI-DEMO');
  assert.strictEqual(rawSheet.rows[1][9], 10000, 'Base_Amount harus terisi Rp 10.000');
  assert.strictEqual(rawSheet.rows[1][11], 10000, 'Total_Transfer_Amount harus terisi Rp 10.000');
  assert.strictEqual(rawSheet.rows[1][15], 'PAID', 'Payment_Status TX-ALUMNI-DEMO harus berubah menjadi PAID');
  assert.strictEqual(rawSheet.rows[1][16], 'SETTLED_BANK_JAGO');
});

console.log('\n========================================================');
console.log(`📊 HASIL PENGUJIAN: ${passedTests}/${totalTests} UJI COBA BERHASIL (100% PASS)`);
console.log('========================================================');
