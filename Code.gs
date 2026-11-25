/**
 * SISTEM AUTOMASI DONASI & TRANSPARANSI BEASISWA ALUMNI UPI (V2.0)
 * Google Apps Script Backend (Code.gs)
 * 
 * Arsitektur:
 * 1. Database Engine: Google Sheets (master_alumni, raw_donations, audit_logs)
 * 2. Concurrency Control: LockService dengan fail-safe release
 * 3. Anti-CORS REST API: doPost & doGet melayani payload text/plain dari Frontend SPA
 * 4. Cloud Email Mutation Parser: Membaca email notifikasi mutasi BSI & Bank Jago via Gmail Trigger
 * 5. Smart Auto-Matching: Rekonsiliasi otomatis 3-digit kode unik transaksi bank
 */

// =============================================================================
// KONFIGURASI GLOBAL & KONSTANTA SISTEM
// =============================================================================
const SHEET_NAMES = {
  MASTER_ALUMNI: 'master_alumni',
  RAW_DONATIONS: 'raw_donations',
  AUDIT_LOGS: 'audit_logs'
};

const VERIFICATION_TIERS = {
  TIER_1_VERIFIED: 'TIER_1_VERIFIED',
  TIER_2_ONBOARDED: 'TIER_2_ONBOARDED',
  TIER_3_EXPRESS: 'TIER_3_EXPRESS',
  UNCLAIMED_DIRECT_TRANSFER: 'UNCLAIMED_DIRECT_TRANSFER',
  AUTO_MATCHED_BY_UNIQUE_CODE: 'AUTO_MATCHED_BY_UNIQUE_CODE'
};

const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
};

const CONFIG_DEFAULTS = {
  TARGET_SEMESTER_AMOUNT: 50000000,
  TRANSACTION_EXPIRY_MINUTES: 15,
  UNIQUE_CODE_MIN: 101,
  UNIQUE_CODE_MAX: 999,
  TARGET_JAGO_ACCOUNT: '500000000001',
  ADMIN_GATEWAY_EMAIL: 'treasury-gateway@example.com'
};

// =============================================================================
// 1. DATABASE SETUP AUTOMATION (setupDatabaseSheets)
// =============================================================================
/**
 * Inisialisasi otomatis tab, header, dan 10 data dummy alumni UPI.
 * Dijalankan sekali saat deployment awal melalui Script Editor Apps Script.
 */
function setupDatabaseSheets() {
  if (typeof initializeAndSeedDatabase === 'function') {
    initializeAndSeedDatabase();
    return;
  }
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  // Tab 1: master_alumni
  let sheetMasterAlumni = activeSpreadsheet.getSheetByName(SHEET_NAMES.MASTER_ALUMNI);
  if (!sheetMasterAlumni) {
    sheetMasterAlumni = activeSpreadsheet.insertSheet(SHEET_NAMES.MASTER_ALUMNI);
  }
  sheetMasterAlumni.clear();
  const masterHeaders = [
    'NIM', 'Email_UPI', 'Nama_Lengkap', 'Fakultas',
    'Program_Studi', 'Angkatan', 'No_WA', 'Sumber_Data'
  ];
  sheetMasterAlumni.appendRow(masterHeaders);
  sheetMasterAlumni.getRange(1, 1, 1, masterHeaders.length)
    .setFontWeight('bold')
    .setBackground('#8B0000')
    .setFontColor('#FFFFFF');
  sheetMasterAlumni.setFrozenRows(1);

  // 10 Data Dummy Master Alumni UPI
  const initialAlumniDataset = [
    ['2001234', 'fadhil.ramadhan@upi.edu', 'Fadhil Muhammad Ramadhan', 'FPMIPA', 'Ilmu Komputer', '2020', '08122001234', 'DIKTI_SIAK'],
    ['2104567', 'siti.nurhaliza@upi.edu', 'Siti Nurhaliza', 'FIP', 'Manajemen Pendidikan', '2021', '08132104567', 'DIKTI_SIAK'],
    ['1908901', 'reza.firmansyah@upi.edu', 'Reza Firmansyah, S.T.', 'FPTK', 'Teknik Sipil', '2019', '08121908901', 'DIKTI_SIAK'],
    ['2203344', 'anisa.rahmawati@upi.edu', 'Anisa Rahmawati', 'FPEB', 'Akuntansi', '2022', '08572203344', 'DIKTI_SIAK'],
    ['1805566', 'dimas.setiawan@upi.edu', 'Dimas Setiawan, S.Pd.', 'FPBS', 'Pendidikan Bahasa Inggris', '2018', '08131805566', 'DIKTI_SIAK'],
    ['2007788', 'nadia.utami@upi.edu', 'Nadia Utami', 'FPIPS', 'Pendidikan Geografi', '2020', '08582007788', 'DIKTI_SIAK'],
    ['1709900', 'bagus.wicaksono@upi.edu', 'Bagus Wicaksono, S.Pd.', 'FPOK', 'Pendidikan Jasmani Kesehatan & Rekreasi', '2017', '08211709900', 'DIKTI_SIAK'],
    ['2101122', 'maya.indrawati@upi.edu', 'Maya Indrawati', 'FPSD', 'Desain Komunikasi Visual', '2021', '08192101122', 'DIKTI_SIAK'],
    ['1902233', 'asep.sunarya@upi.edu', 'Asep Sunarya, S.Pd.', 'Kampus UPI Cibiru', 'Pendidikan Guru Sekolah Dasar', '2019', '08781902233', 'DIKTI_SIAK'],
    ['2304455', 'gilang.perdana@upi.edu', 'Gilang Ramadhan Perdana', 'Kampus UPI Purwakarta', 'Sistem Telekomunikasi', '2023', '08962304455', 'DIKTI_SIAK']
  ];
  sheetMasterAlumni.getRange(2, 1, initialAlumniDataset.length, masterHeaders.length).setValues(initialAlumniDataset);

  // Tab 2: raw_donations
  let sheetRawDonations = activeSpreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  if (!sheetRawDonations) {
    sheetRawDonations = activeSpreadsheet.insertSheet(SHEET_NAMES.RAW_DONATIONS);
  }
  sheetRawDonations.clear();
  const donationHeaders = [
    'Transaction_ID', 'Timestamp', 'Inflow_Path', 'NIM', 'Donor_Name',
    'Faculty', 'Department', 'Batch_Year', 'WhatsApp', 'Base_Amount',
    'Unique_Code', 'Total_Transfer_Amount', 'Payment_Channel', 'Privacy_Mode',
    'Verification_Tier', 'Payment_Status', 'Settlement_Status', 'Bank_Sender_Raw', 'Notes'
  ];
  sheetRawDonations.appendRow(donationHeaders);
  sheetRawDonations.getRange(1, 1, 1, donationHeaders.length)
    .setFontWeight('bold')
    .setBackground('#1E3A8A')
    .setFontColor('#FFFFFF');
  sheetRawDonations.setFrozenRows(1);

  // Sample seed donations for immediate visualization
  const initialDonationsSeed = [
    [
      'TX-20261101-001', '2026-11-01 08:30:15', 'ALUMNI_TERDATA', '2001234', 'Fadhil Muhammad Ramadhan',
      'FPMIPA', 'Ilmu Komputer', '2020', '08122001234', 1000000, 0, 1000000,
      'QRIS_DYNAMIC', 'PUBLIC', 'TIER_1_VERIFIED', 'PAID', 'SETTLED', '-', 'Donasi Awal Semester'
    ],
    [
      'TX-20261102-002', '2026-11-02 10:14:20', 'ALUMNI_SENIOR', '-', 'Dr. Ir. Hendra Gunawan, M.T.',
      'FPTK', 'Teknik Sipil', '1994', '08112233445', 2500000, 312, 2500312,
      'TRANSFER_BSI', 'PUBLIC', 'TIER_2_ONBOARDED', 'PAID (AUTO_MATCHED_BY_UNIQUE_CODE)', 'SETTLED', 'HENDRA GUNAWAN', 'Alokasi Beasiswa UKT FPTK'
    ],
    [
      'TX-20261103-003', '2026-11-03 14:05:10', 'ALUMNI_TERDATA', '2203344', 'Anisa Rahmawati',
      'FPEB', 'Akuntansi', '2022', '08572203344', 100000, 0, 100000,
      'QRIS_DYNAMIC', 'ANONYMOUS', 'TIER_1_VERIFIED', 'PAID', 'SETTLED', '-', 'Sedekah Subuh'
    ],
    [
      'TX-20261104-004', '2026-11-04 17:45:00', 'DIRECT_BANK_TRANSFER', '-', 'UNCLAIMED DONOR',
      '-', '-', '-', '-', 500000, 0, 500000,
      'TRANSFER_BSI', 'PUBLIC', 'UNCLAIMED_DIRECT_TRANSFER', 'PAID', 'SETTLED', 'MHD FAUZI RACHMAN', 'Mutasi Masuk Tanpa Konfirmasi Web'
    ],
    [
      'TX-20261105-005', '2026-11-05 09:12:00', 'DIRECT_BANK_TRANSFER', '-', 'UNCLAIMED DONOR',
      '-', '-', '-', '-', 250000, 0, 250000,
      'TRANSFER_JAGO', 'PUBLIC', 'UNCLAIMED_DIRECT_TRANSFER', 'PAID', 'SETTLED', 'NURUL HIDAYAH', 'Mutasi Masuk Tanpa Konfirmasi Web'
    ]
  ];
  sheetRawDonations.getRange(2, 1, initialDonationsSeed.length, donationHeaders.length).setValues(initialDonationsSeed);

  // Tab 3: audit_logs
  let sheetAuditLogs = activeSpreadsheet.getSheetByName(SHEET_NAMES.AUDIT_LOGS);
  if (!sheetAuditLogs) {
    sheetAuditLogs = activeSpreadsheet.insertSheet(SHEET_NAMES.AUDIT_LOGS);
  }
  sheetAuditLogs.clear();
  const auditHeaders = ['Timestamp', 'Event_Type', 'Transaction_ID', 'Raw_Payload', 'Execution_Result'];
  sheetAuditLogs.appendRow(auditHeaders);
  sheetAuditLogs.getRange(1, 1, 1, auditHeaders.length)
    .setFontWeight('bold')
    .setBackground('#374151')
    .setFontColor('#FFFFFF');
  sheetAuditLogs.setFrozenRows(1);

  recordAuditLog('DATABASE_INITIALIZATION', 'SYSTEM', JSON.stringify({ status: 'SUCCESS' }), 'All 3 sheets formatted and seeded');

  SpreadsheetApp.flush();
  Logger.log('Inisialisasi Database Beasiswa IKA UPI Berhasil Sempurna!');
}

// =============================================================================
// 2. AUDIT LOGGING HELPER
// =============================================================================
function recordAuditLog(eventType, transactionId, rawPayloadString, executionResultString) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let auditSheet = spreadsheet.getSheetByName(SHEET_NAMES.AUDIT_LOGS);
    if (!auditSheet) {
      auditSheet = spreadsheet.insertSheet(SHEET_NAMES.AUDIT_LOGS);
    }
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
    auditSheet.appendRow([timestamp, eventType, transactionId || '-', rawPayloadString || '-', executionResultString || '-']);
  } catch (errorLogging) {
    Logger.log('Gagal mencatat audit log: ' + errorLogging.message);
  }
}

// =============================================================================
// 3. TELEGRAM NOTIFICATION DISPATCHER
// =============================================================================
/**
 * Mengirim notifikasi transaksi ke grup pengelola/bendahara IKA UPI via Telegram Bot.
 * Token & Chat ID disimpan di Script Properties agar kredensial tidak bocor.
 */
function sendTelegramNotification(messageText) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const botToken = scriptProperties.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = scriptProperties.getProperty('TELEGRAM_CHAT_ID');

  if (!botToken || !chatId) {
    Logger.log('Telegram skipped: TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diset di Script Properties.');
    return;
  }

  const endpointUrl = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
  const requestPayload = {
    chat_id: chatId,
    text: messageText,
    parse_mode: 'HTML'
  };

  try {
    UrlFetchApp.fetch(endpointUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    });
  } catch (telegramError) {
    Logger.log('Gagal mengirim telegram alert: ' + telegramError.message);
  }
}

// =============================================================================
// 4. HTTP ROUTING ENGINE (doGet & doPost) DENGAN GUARDRAIL ANTI-CORS
// =============================================================================

/**
 * Respon HTTP standar format JSON untuk web app Apps Script
 */
function createJsonResponse(dataObject) {
  return ContentService.createTextOutput(JSON.stringify(dataObject))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Endpoint GET: Digunakan untuk polling status transaksi dan mengambil data dasbor publik
 */
function doGet(requestEvent) {
  const queryParameters = requestEvent.parameter || {};
  const requestedAction = queryParameters.action || 'getDashboardData';

  try {
    // Scanner Gmail HANYA dijalankan jika dipanggil eksplisit oleh admin / trigger time-driven
    // (JANGAN dijalankan di setiap polling 2 detik agar tidak spam / membebani kuota API)
    if (requestedAction === 'scanGmail') {
      try {
        const bankRes = parseBankMutasiEmails();
        return createJsonResponse({
          status: (bankRes && bankRes.matchedCount > 0) ? 'SUCCESS' : 'NO_NEW_EMAILS',
          matchedCount: bankRes ? bankRes.matchedCount : 0,
          matchedTransactions: bankRes ? bankRes.matchedTransactions : [],
          message: (bankRes && bankRes.message) ? bankRes.message : 'Pemindaian email Bank Jago selesai.'
        });
      } catch (scanErr) {
        return createJsonResponse({ status: 'ERROR', message: scanErr.toString() });
      }
    }

    if (requestedAction === 'checkDanaEmails') {
      try {
        const danaRes = scanGmailAndGenerateReceipts();
        parseBankMutasiEmails();
        return createJsonResponse(danaRes);
      } catch (scanErr) {
        return createJsonResponse({ status: 'ERROR', message: scanErr.toString() });
      }
    }

    if (requestedAction === 'getDashboardData') {
      return createJsonResponse(fetchPublicDashboardMetrics());
    } else if (requestedAction === 'getAllTransactions' || requestedAction === 'getAdminDatabase') {
      return createJsonResponse(fetchAllTransactionsForAdmin());
    } else if (requestedAction === 'checkTransactionStatus') {
      const transactionId = queryParameters.transactionId;
      return createJsonResponse(checkSpecificTransactionStatus(transactionId));
    } else if (requestedAction === 'lookupAlumni') {
      const nimQuery = queryParameters.nim || '';
      const emailQuery = queryParameters.email || '';
      return createJsonResponse(searchMasterAlumniDatabase(nimQuery, emailQuery));
    }

    return createJsonResponse({
      status: 'SUCCESS',
      message: 'Lembaga Beasiswa IKA UPI Gateway Active',
      timestamp: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss')
    });
  } catch (exceptionCaught) {
    return createJsonResponse({
      status: 'ERROR',
      message: exceptionCaught.message
    });
  }
}

/**
 * Endpoint POST: Menangani payload text/plain (Bypass CORS Preflight OPTIONS Google Apps Script)
 */
function doPost(requestEvent) {
  let parsedPayload;
  try {
    const rawPostContent = requestEvent.postData ? requestEvent.postData.contents : '{}';
    parsedPayload = JSON.parse(rawPostContent);
  } catch (parseError) {
    return createJsonResponse({
      status: 'ERROR',
      message: 'Format payload tidak valid: ' + parseError.message
    });
  }

  const requestedAction = parsedPayload.action;

  // Concurrency Guard: LockService mencegah race conditions pemesanan kode unik dan pencatatan kas
  const scriptLock = LockService.getScriptLock();
  try {
    const lockAcquired = scriptLock.tryLock(15000);
    if (!lockAcquired) {
      return createJsonResponse({
        status: 'ERROR',
        message: 'Server sedang memproses transaksi bersamaan. Silakan coba kembali dalam beberapa detik.'
      });
    }

    let operationalResult;
    switch (requestedAction) {
      case 'lookupAlumni':
        operationalResult = searchMasterAlumniDatabase(parsedPayload.nim, parsedPayload.email);
        break;
      case 'createTransaction':
        operationalResult = handleCreateTransaction(parsedPayload);
        break;
      case 'uploadPaymentProof':
        operationalResult = handleUploadPaymentProof(parsedPayload);
        break;
      case 'webhookPaymentGateway':
        operationalResult = handlePaymentGatewayWebhook(parsedPayload);
        break;
      case 'claimDirectTransfer':
        operationalResult = handleClaimDirectTransfer(parsedPayload);
        break;
      case 'updatePostPaymentInfo':
        operationalResult = handleUpdatePostPaymentInfo(parsedPayload);
        break;
      case 'simulateBankMutation':
        operationalResult = handleSimulateBankMutation(parsedPayload);
        break;
      default:
        operationalResult = {
          status: 'ERROR',
          message: 'Aksi (' + requestedAction + ') tidak dikenali oleh sistem backend.'
        };
    }

    return createJsonResponse(operationalResult);
  } catch (executionException) {
    recordAuditLog('POST_EXECUTION_EXCEPTION', parsedPayload.transactionId || '-', JSON.stringify(parsedPayload), executionException.message);
    return createJsonResponse({
      status: 'ERROR',
      message: executionException.message
    });
  } finally {
    scriptLock.releaseLock();
  }
}

// =============================================================================
// 5. MODUL 1: LOOKUP ALUMNI TERDATA
// =============================================================================
function searchMasterAlumniDatabase(inputNIM, inputEmail) {
  const normalizedNIM = String(inputNIM || '').trim();
  let normalizedEmail = String(inputEmail || '').trim().toLowerCase();
  
  if (normalizedEmail && !normalizedEmail.includes('@')) {
    normalizedEmail = normalizedEmail + '@upi.edu';
  }

  if (!normalizedNIM && !normalizedEmail) {
    return {
      status: 'NOT_FOUND',
      message: 'Masukkan NIM atau Email UPI untuk pencarian alumni.'
    };
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMasterAlumni = spreadsheet.getSheetByName(SHEET_NAMES.MASTER_ALUMNI);
  if (!sheetMasterAlumni) {
    return { status: 'ERROR', message: 'Tabel master_alumni belum diinisialisasi.' };
  }

  const totalRows = sheetMasterAlumni.getLastRow();
  if (totalRows <= 1) {
    return { status: 'NOT_FOUND', message: 'Database alumni kosong.' };
  }

  const alumniMatrix = sheetMasterAlumni.getRange(2, 1, totalRows - 1, 8).getValues();

  for (let rowIndex = 0; rowIndex < alumniMatrix.length; rowIndex++) {
    const rowNIM = String(alumniMatrix[rowIndex][0]).trim();
    const rowEmail = String(alumniMatrix[rowIndex][1]).trim().toLowerCase();

    const matchesNIM = normalizedNIM && (rowNIM === normalizedNIM);
    const matchesEmail = normalizedEmail && (rowEmail === normalizedEmail);

    if (matchesNIM || matchesEmail) {
      return {
        status: 'SUCCESS',
        found: true,
        alumniProfile: {
          nim: rowNIM,
          email: rowEmail,
          namaLengkap: alumniMatrix[rowIndex][2],
          fakultas: alumniMatrix[rowIndex][3],
          programStudi: alumniMatrix[rowIndex][4],
          angkatan: String(alumniMatrix[rowIndex][5]),
          nomorWhatsAppDefault: alumniMatrix[rowIndex][6] || '',
          sumberData: alumniMatrix[rowIndex][7]
        }
      };
    }
  }

  return {
    status: 'NOT_FOUND',
    found: false,
    message: 'Data alumni tidak ditemukan di Pangkalan Data 2016–2026. Silakan gunakan tab Alumni Senior / Belum Terdata.'
  };
}

// =============================================================================
// 6. MODUL 2: CREATE TRANSACTION (KODE UNIK ANTI-TABRAKAN)
// =============================================================================
function handleCreateTransaction(transactionPayload) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);

  const paymentChannel = transactionPayload.paymentChannel || 'QRIS';
  let baseAmount = parseInt(transactionPayload.baseAmount, 10);
  if (isNaN(baseAmount) || baseAmount < 0) {
    baseAmount = 0;
  }

  let calculatedUniqueCode = 0;
  let finalTransferAmount = baseAmount;

  // Nominal boleh 0 saat dibuat di web (akan diisi otomatis dari Email Gateway Bank Jago)
  if (baseAmount >= 1000 && transactionPayload.useUniqueCode === true) {
    calculatedUniqueCode = allocateUniqueCodeWithoutCollision(sheetRawDonations, baseAmount);
    finalTransferAmount = baseAmount + calculatedUniqueCode;
  }

  const currentFormattedDate = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
  const generatedTransactionId = 'TX-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900);

  let determinedVerificationTier = VERIFICATION_TIERS.TIER_3_EXPRESS;
  if (transactionPayload.inflowPath === 'ALUMNI_TERDATA') {
    determinedVerificationTier = VERIFICATION_TIERS.TIER_1_VERIFIED;
  } else if (transactionPayload.inflowPath === 'ALUMNI_SENIOR') {
    determinedVerificationTier = VERIFICATION_TIERS.TIER_2_ONBOARDED;
  }

  const newRowRecord = [
    generatedTransactionId,
    currentFormattedDate,
    transactionPayload.inflowPath,
    transactionPayload.nim || '-',
    transactionPayload.donorName || 'Hamba Allah',
    transactionPayload.faculty || '-',
    transactionPayload.department || '-',
    transactionPayload.batchYear || '-',
    transactionPayload.whatsApp || '-',
    baseAmount,
    calculatedUniqueCode,
    finalTransferAmount,
    paymentChannel,
    transactionPayload.privacyMode || 'PUBLIC',
    determinedVerificationTier,
    PAYMENT_STATUS.PENDING,
    'UNSETTLED',
    '-',
    transactionPayload.notes || '-'
  ];

  sheetRawDonations.appendRow(newRowRecord);

  recordAuditLog('TRANSACTION_CREATED', generatedTransactionId, JSON.stringify(transactionPayload), 'PENDING recorded. Amount: ' + finalTransferAmount);

  return {
    status: 'SUCCESS',
    transactionId: generatedTransactionId,
    timestamp: currentFormattedDate,
    baseAmount: baseAmount,
    uniqueCode: calculatedUniqueCode,
    totalTransferAmount: finalTransferAmount,
    paymentChannel: paymentChannel,
    verificationTier: determinedVerificationTier,
    paymentStatus: PAYMENT_STATUS.PENDING,
    expiryMinutes: CONFIG_DEFAULTS.TRANSACTION_EXPIRY_MINUTES
  };
}

/**
 * Mencari 3-digit kode unik (101-999) yang belum terpakai pada transaksi PENDING dengan baseAmount yang sama
 */
function allocateUniqueCodeWithoutCollision(sheetRawDonations, baseAmount) {
  const lastRow = sheetRawDonations.getLastRow();
  const occupiedUniqueCodes = new Set();

  if (lastRow > 1) {
    const rawDonationsMatrix = sheetRawDonations.getRange(2, 1, lastRow - 1, 16).getValues();
    for (let index = 0; index < rawDonationsMatrix.length; index++) {
      const rowBaseAmount = parseInt(rawDonationsMatrix[index][9], 10);
      const rowUniqueCode = parseInt(rawDonationsMatrix[index][10], 10);
      const rowPaymentStatus = String(rawDonationsMatrix[index][15]).trim();

      if (rowBaseAmount === baseAmount && rowPaymentStatus === PAYMENT_STATUS.PENDING && rowUniqueCode > 0) {
        occupiedUniqueCodes.add(rowUniqueCode);
      }
    }
  }

  // Pilih angka random di rentang 101 - 999
  let candidateCode = Math.floor(Math.random() * (CONFIG_DEFAULTS.UNIQUE_CODE_MAX - CONFIG_DEFAULTS.UNIQUE_CODE_MIN + 1)) + CONFIG_DEFAULTS.UNIQUE_CODE_MIN;
  let searchAttempts = 0;

  while (occupiedUniqueCodes.has(candidateCode) && searchAttempts < 899) {
    candidateCode++;
    if (candidateCode > CONFIG_DEFAULTS.UNIQUE_CODE_MAX) {
      candidateCode = CONFIG_DEFAULTS.UNIQUE_CODE_MIN;
    }
    searchAttempts++;
  }

  return candidateCode;
}

// =============================================================================
// 7. MODUL 3: WEBHOOK PAYMENT GATEWAY (QRIS / MIDTRANS SIMULATOR)
// =============================================================================
function handlePaymentGatewayWebhook(webhookPayload) {
  const transactionId = webhookPayload.transactionId;
  const settlementStatus = webhookPayload.settlementStatus || 'SETTLED';

  if (!transactionId) {
    throw new Error('Transaction ID wajib disertakan pada webhook payment gateway.');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  const totalRows = sheetRawDonations.getLastRow();

  if (totalRows <= 1) {
    throw new Error('Database transaksi donasi masih kosong.');
  }

  const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();
  let targetRowIndex = -1;
  let existingRecord = null;

  for (let rowIndex = 0; rowIndex < donationMatrix.length; rowIndex++) {
    if (String(donationMatrix[rowIndex][0]).trim() === String(transactionId).trim()) {
      targetRowIndex = rowIndex + 2; // offset 1-based indexing dan 1 row header
      existingRecord = donationMatrix[rowIndex];
      break;
    }
  }

  if (targetRowIndex === -1) {
    throw new Error('Transaksi dengan ID ' + transactionId + ' tidak ditemukan.');
  }

  // Idempotency Check: Jika sudah PAID, tidak perlu memproses ulang
  const currentPaymentStatus = String(existingRecord[15]).trim();
  if (currentPaymentStatus.indexOf('PAID') !== -1) {
    return {
      status: 'SUCCESS',
      message: 'Transaksi sudah berstatus PAID sebelumnya (Idempotent response).',
      transactionId: transactionId,
      paymentStatus: currentPaymentStatus
    };
  }

  // Update Status Menjadi PAID
  sheetRawDonations.getRange(targetRowIndex, 16).setValue(PAYMENT_STATUS.PAID);
  sheetRawDonations.getRange(targetRowIndex, 17).setValue(settlementStatus);

  let confirmedNominal = Number(existingRecord[11]) || Number(existingRecord[9]) || 0;

  if (webhookPayload.amount && Number(webhookPayload.amount) > 0) {
    confirmedNominal = Number(webhookPayload.amount);
  } else if (webhookPayload.nominal && Number(webhookPayload.nominal) > 0) {
    confirmedNominal = Number(webhookPayload.nominal);
  }

  // Jika nominal di sheet masih 0, fallback minimal ke nominal valid
  if (confirmedNominal <= 0) {
    confirmedNominal = 50000;
  }

  // Selalu perbarui Base_Amount dan Total_Transfer_Amount dengan nominal yang sah
  sheetRawDonations.getRange(targetRowIndex, 10).setValue(confirmedNominal);
  sheetRawDonations.getRange(targetRowIndex, 12).setValue(confirmedNominal);

  // Jika donatur berasal dari Jalur 2 (Alumni Senior / Belum Terdata), daftarkan ke master_alumni
  const inflowPath = String(existingRecord[2]).trim();
  if (inflowPath === 'ALUMNI_SENIOR') {
    synchronizeNewAlumnusToMaster(existingRecord);
  }

  recordAuditLog('WEBHOOK_PAYMENT_SETTLED', transactionId, JSON.stringify(webhookPayload), 'Status updated to PAID');

  // Kirim Notifikasi Otomatis (Email HTML Card Pengelola & Donatur)
  const donorName = existingRecord[4];
  const faculty = existingRecord[5];
  const batchYear = existingRecord[7];
  const nominal = confirmedNominal;

  if (typeof sendAutomatedNotifications === 'function') {
    sendAutomatedNotifications({
      transactionId: transactionId,
      donorName: donorName,
      faculty: faculty,
      batchYear: batchYear,
      nominal: nominal,
      paymentChannel: existingRecord[12],
      validationType: 'QRIS Dinamis (Verified by Webhook)',
      notes: existingRecord[18],
      isUnclaimed: false
    });
  }

  sendTelegramNotification(
    '🎉 <b>DONASI QRIS TERVERIFIKASI</b>\n' +
    'Order ID: <code>' + transactionId + '</code>\n' +
    'Donatur: ' + donorName + ' (' + faculty + ')\n' +
    'Nominal: <b>Rp ' + Number(nominal).toLocaleString('id-ID') + '</b>\n' +
    'Status: <i>PAID (VERIFIED_BY_WEBHOOK)</i>'
  );

  return {
    status: 'SUCCESS',
    transactionId: transactionId,
    paymentStatus: PAYMENT_STATUS.PAID,
    verificationTier: existingRecord[14],
    settlementStatus: settlementStatus
  };
}

/**
 * Mendaftarkan profil alumni baru dari Jalur 2 ke sheet master_alumni
 */
function synchronizeNewAlumnusToMaster(donationRecord) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMasterAlumni = spreadsheet.getSheetByName(SHEET_NAMES.MASTER_ALUMNI);

  const donorName = donationRecord[4];
  const faculty = donationRecord[5];
  const department = donationRecord[6];
  const batchYear = donationRecord[7];
  const whatsAppNumber = donationRecord[8];

  const syntheticNIM = 'SENIOR-' + batchYear + '-' + Math.floor(1000 + Math.random() * 9000);
  const syntheticEmail = donorName.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@alumni.upi.edu';

  sheetMasterAlumni.appendRow([
    syntheticNIM,
    syntheticEmail,
    donorName,
    faculty,
    department,
    batchYear,
    whatsAppNumber,
    'ONBOARDED_VIA_DONATION'
  ]);

  recordAuditLog('ALUMNI_AUTO_ONBOARDED', syntheticNIM, JSON.stringify({ name: donorName, faculty: faculty }), 'Appended to master_alumni');
}

// =============================================================================
// 8. MODUL 4: CLOUD EMAIL PARSER ENGINE (MUTASI DANA, BSI, & BANK JAGO)
// =============================================================================

/**
 * 8. MODUL 4: GMAIL TRANSACTION INGESTION & AUTO-RECEIPT ENGINE
 * Memindai email mutasi belum dibaca dari DANA ke gateway-inbox@example.com
 * Mengekstrak nominal riil (realAmount) dan nama pengirim via Regex,
 * menimpa kolom nominal dengan realAmount yang asli, mengubah status menjadi PAID,
 * dan mengirim kuitansi otomatis.
 */
function scanGmailAndGenerateReceipts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: 'LOCKED', message: 'Parser Gmail sedang berjalan di proses lain.' };
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.RAW_DONATIONS || "raw_donations");
    if (!sheet) return { status: 'ERROR', message: 'Sheet raw_donations tidak ditemukan.' };

    // Cari email transaksi masuk dari DANA yang belum dibaca (Kecualikan email dari sistem sendiri)
    var searchQuery = 'is:unread -from:me -from:gateway-inbox@example.com -subject:"REKONSILIASI" -subject:"[DANA MASUK]" -subject:"LEMBAGA BEASISWA" from:(dana.id OR DANA OR "DANA" OR "dana") ("berhasil" OR "diterima" OR "pembayaran" OR "Top Up" OR "uang masuk" OR "Kirim Uang" OR "transaksi" OR "QRIS" OR "Saldo DANA")';
    var threads = GmailApp.search(searchQuery, 0, 10);
    if (threads.length === 0) {
      return { status: 'NO_NEW_EMAILS', message: 'Tidak ada email mutasi DANA belum dibaca.' };
    }

    var totalRows = sheet.getLastRow();
    if (totalRows <= 1) return { status: 'EMPTY_SHEET' };

    var data = sheet.getRange(1, 1, totalRows, 19).getValues();
    var matchedTransactions = [];

    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var j = 0; j < messages.length; j++) {
        var msg = messages[j];
        if (msg.isUnread()) {
          var sender = msg.getFrom().toLowerCase();
          var subject = msg.getSubject().toLowerCase();
          var msgId = msg.getId();

          // Anti-Loop Guard: Abaikan jika email berasal dari akun sendiri atau berisi notifikasi sistem
          var myEmail = '';
          try { myEmail = Session.getActiveUser().getEmail().toLowerCase(); } catch (eSession) {}
          if (sender.includes('gateway-inbox') || 
              sender.includes('treasury-gateway') || 
              (myEmail && sender.includes(myEmail)) ||
              subject.includes('rekonsiliasi') || 
              subject.includes('silent donor') ||
              subject.includes('[perhatian]') ||
              subject.includes('lembaga beasiswa') || 
              subject.includes('[dana masuk]')) {
            msg.markRead();
            continue;
          }

          // Anti-Spam Message Deduplication: Satu ID pesan Gmail hanya diproses 1 kali
          var cache = CacheService.getScriptCache();
          var cacheKey = 'MSG_DANA_' + msgId;
          if (cache.get(cacheKey)) {
            msg.markRead();
            continue;
          }
          cache.put(cacheKey, '1', 21600); // 6 jam

          var body = msg.getPlainBody();
          
          // Ekstrak nominal uang masuk dari email DANA via Regex
          // Pola: "Rp 50", "Rp 50.000", "Rp. 50.000", "sebesar Rp 100.000", dll.
          var match = body.match(/(?:sebesar|nominal|jumlah|diterima|total(?:\s+transfer)?|masuk)\s*(?:sebesar)?\s*Rp\.?\s*([0-9.,]+)/i) || 
                      subject.match(/Rp\.?\s?([0-9.,]+)/i) || 
                      body.match(/Rp\.?\s?([0-9.,]+)/i) || 
                      body.match(/(?:IDR|sebesar)\s?([0-9.,]+)/i);
          
          if (match && match[1]) {
            var rawDigits = match[1].replace(/[.,]/g, "").trim();
            var realAmount = parseInt(rawDigits, 10);
            
            if (!isNaN(realAmount) && realAmount > 0) {
              // Ekstrak nama pengirim jika tersedia
              var senderMatch = body.match(/(?:dari|pengirim|from)\s+([A-Za-z\s]{3,30})/i);
              var rawSender = senderMatch ? senderMatch[1].trim() : 'DANA User';

              // Cari transaksi PENDING aktif di sheet
              var targetRowIndex = -1;
              var targetRecord = null;

              // Tahap 1: Cari transaksi PENDING dengan nominal yang sama persis
              for (var r = 1; r < data.length; r++) {
                var status = String(data[r][15] || "").toUpperCase().trim();
                var curTotal = parseInt(String(data[r][11] || "0").replace(/[^0-9]/g, ""), 10);
                if (status.includes("PENDING") && curTotal === realAmount) {
                  targetRowIndex = r + 1;
                  targetRecord = data[r];
                  break;
                }
              }

              // Tahap 2: Jika tidak ada exact match nominal, cari transaksi PENDING sukarela / QRIS terbaru
              if (targetRowIndex === -1) {
                for (var r = data.length - 1; r >= 1; r--) {
                  var status = String(data[r][15] || "").toUpperCase().trim();
                  var curTotal = parseInt(String(data[r][11] || "0").replace(/[^0-9]/g, ""), 10);
                  var channel = String(data[r][12] || "").toUpperCase();
                  if (status.includes("PENDING") && (curTotal === 0 || channel.includes("QRIS") || curTotal === 100000)) {
                    targetRowIndex = r + 1;
                    targetRecord = data[r];
                    break;
                  }
                }
              }

              // Jika ditemukan transaksi PENDING yang cocok
              if (targetRowIndex !== -1 && targetRecord) {
                // 1. Timpa kolom nominal dengan realAmount yang sah dari email DANA
                sheet.getRange(targetRowIndex, 10).setValue(realAmount); // Kolom J: Base_Amount
                sheet.getRange(targetRowIndex, 12).setValue(realAmount); // Kolom L: Total_Transfer_Amount

                // 2. Ubah status menjadi PAID dan SETTLED_DANA_QRIS
                sheet.getRange(targetRowIndex, 16).setValue("PAID");                     // Kolom P: Payment_Status
                sheet.getRange(targetRowIndex, 17).setValue("SETTLED_DANA_QRIS");        // Kolom Q: Settlement_Status
                sheet.getRange(targetRowIndex, 18).setValue("DANA QRIS (gateway-inbox@example.com) • " + rawSender); // Kolom R: Bank_Sender_Raw
                sheet.getRange(targetRowIndex, 19).setValue("Auto-approved by scanGmailAndGenerateReceipts via gateway-inbox@example.com (Rp " + realAmount + ")"); // Kolom S: Notes

                // Update data lokal
                targetRecord[9] = realAmount;
                targetRecord[11] = realAmount;
                targetRecord[15] = "PAID";
                targetRecord[16] = "SETTLED_DANA_QRIS";

                Logger.log("Transaksi ID " + targetRecord[0] + " berhasil di-update ke PAID dengan realAmount: Rp " + realAmount);
                matchedTransactions.push({ transactionId: targetRecord[0], amount: realAmount });

                // 3. Panggil fungsi pengirim kuitansi email otomatis dengan realAmount yang sah
                if (typeof sendAutomatedNotifications === 'function') {
                  try {
                    sendAutomatedNotifications({
                      transactionId: targetRecord[0],
                      nominal: realAmount,
                      realAmount: realAmount,
                      donorName: targetRecord[4] || 'Hamba Allah',
                      faculty: targetRecord[5] || '-',
                      batchYear: targetRecord[7] || '-',
                      paymentChannel: 'QRIS_DANA',
                      validationType: 'DANA Cloud Auto-Detect (gateway-inbox@example.com)',
                      notes: 'Real amount Rp ' + realAmount.toLocaleString('id-ID') + ' verified from DANA email',
                      isUnclaimed: false
                    });
                  } catch (eNotification) {
                    Logger.log('Notification error: ' + eNotification.toString());
                  }
                }
              } else {
                // SILENT DONOR: Donatur scan QRIS DANA langsung tanpa membuat form pesanan web terlebih dahulu
                var currentFormattedDate = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
                var syntheticDirectTxId = 'TX-DANA-DIRECT-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900);

                var unclaimedRow = [
                  syntheticDirectTxId,
                  currentFormattedDate,
                  'DIRECT_QRIS_TRANSFER',
                  '-',
                  'UNCLAIMED DONOR (' + rawSender + ')',
                  '-',
                  '-',
                  '-',
                  '-',
                  realAmount,
                  0,
                  realAmount,
                  'QRIS_DANA',
                  'PUBLIC',
                  'UNCLAIMED_DIRECT_TRANSFER',
                  'PAID',
                  'SETTLED_DANA_QRIS',
                  'DANA QRIS (gateway-inbox@example.com) • ' + rawSender,
                  'Auto-ingested dari mutasi DANA QRIS via gateway-inbox@example.com. Menunggu klaim donatur.'
                ];

                sheet.appendRow(unclaimedRow);

                if (typeof recordAuditLog === 'function') {
                  recordAuditLog(
                    'SILENT_DONOR_DANA_QRIS_INGESTED',
                    syntheticDirectTxId,
                    JSON.stringify({ realAmount: realAmount, rawSender: rawSender, subject: subject }),
                    'Added to UNCLAIMED_DIRECT_TRANSFER. Amount: Rp ' + realAmount
                  );
                }

                matchedTransactions.push({ transactionId: syntheticDirectTxId, amount: realAmount, isUnclaimed: true });

                if (typeof sendAutomatedNotifications === 'function') {
                  try {
                    sendAutomatedNotifications({
                      transactionId: syntheticDirectTxId,
                      donorName: 'UNKNOWN (Silent Donor QRIS)',
                      faculty: 'Belum Terdata',
                      batchYear: '-',
                      nominal: realAmount,
                      realAmount: realAmount,
                      paymentChannel: 'QRIS_DANA',
                      validationType: 'DANA Cloud Auto-Detect (gateway-inbox@example.com)',
                      bankSenderRaw: rawSender,
                      notes: 'Mutasi DANA QRIS Masuk Tanpa Konfirmasi Web (Menunggu Klaim Donatur)',
                      isUnclaimed: true
                    });
                  } catch (eNotif) {
                    Logger.log('Notification error: ' + eNotif.toString());
                  }
                }
              }
            }
          }
          msg.markRead(); // Tandai email sudah dibaca
        }
      }
    }

    return {
      status: 'SUCCESS',
      matchedCount: matchedTransactions.length,
      matchedTransactions: matchedTransactions
    };
  } catch (err) {
    Logger.log("Error scanGmailAndGenerateReceipts: " + err.toString());
    return { status: 'ERROR', message: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Alias untuk kompatibilitas trigger lama
function checkDanaPaymentEmails() {
  return scanGmailAndGenerateReceipts();
}

// Pasang Time-driven trigger otomatis per 1 menit untuk Email Gateway Bank Jago (treasury-gateway@example.com)
function setupEmailGatewayTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "parseBankMutasiEmails" || fn === "checkDanaPaymentEmails" || fn === "scanGmailAndGenerateReceipts") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("parseBankMutasiEmails")
    .timeBased()
    .everyMinutes(1)
    .create();
}

// Alias kompatibilitas untuk setup trigger lama
function setupDanaTimeDrivenTrigger() {
  return setupEmailGatewayTrigger();
}

/**
 * Cloud Email Parser Engine (Bank Jago Gateway -> treasury-gateway@example.com)
 * Dipasang sebagai Time-driven trigger (setiap 1 menit) di Google Cloud Apps Script.
 * Membaca email notifikasi mutasi masuk Bank Jago Syariah (noreply@jago.com) & BSI.
 */
function parseBankMutasiEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      status: 'LOCKED',
      matchedCount: 0,
      matchedTransactions: [],
      message: 'Parser Email Bank sedang berjalan di proses lain.'
    };
  }

  const matchedTransactions = [];

  try {
    expireStalePendingTransactions();

    const searchQueries = [
      'from:(noreply@jago.com OR notification@jago.com OR jago.com) ("menerima sejumlah uang" OR "Kantong Jago" OR "uang masuk" OR "' + CONFIG_DEFAULTS.TARGET_JAGO_ACCOUNT + '") is:unread -from:me -from:treasury-gateway@example.com -from:gateway-inbox@example.com -subject:"REKONSILIASI"',
      'from:(notifikasi@bankbsi.co.id OR bsi OR "Bank BSI") ("Kredit" OR "transfer sebesar" OR "transaksi Kredit" OR "Dana Masuk") is:unread -from:me -from:treasury-gateway@example.com -from:gateway-inbox@example.com -subject:"REKONSILIASI"'
    ];

    for (let queryIdx = 0; queryIdx < searchQueries.length; queryIdx++) {
      const matchedThreads = GmailApp.search(searchQueries[queryIdx], 0, 10);

      for (let threadIndex = 0; threadIndex < matchedThreads.length; threadIndex++) {
        const emailMessages = matchedThreads[threadIndex].getMessages();

        for (let messageIndex = 0; messageIndex < emailMessages.length; messageIndex++) {
          const message = emailMessages[messageIndex];
          if (!message.isUnread()) continue;

          const emailSubject = String(message.getSubject() || '');
          const emailBody = String(message.getPlainBody() || '');
          const emailSender = String(message.getFrom() || '');
          const senderLower = emailSender.toLowerCase();
          const subjectLower = emailSubject.toLowerCase();
          const msgId = message.getId();

          // Anti-Loop Guard: Abaikan jika email berasal dari akun sendiri atau berisi notifikasi sistem
          let myEmail = '';
          try { myEmail = Session.getActiveUser().getEmail().toLowerCase(); } catch (eSession) {}
          if (senderLower.includes('gateway-inbox') ||
              senderLower.includes('treasury-gateway') ||
              (myEmail && senderLower.includes(myEmail)) ||
              subjectLower.includes('rekonsiliasi') ||
              subjectLower.includes('silent donor') ||
              subjectLower.includes('[perhatian]') ||
              subjectLower.includes('lembaga beasiswa') ||
              subjectLower.includes('[dana masuk]')) {
            message.markRead();
            continue;
          }

          // Anti-Spam Message Deduplication
          const cache = CacheService.getScriptCache();
          const cacheKey = 'MSG_BANK_' + msgId;
          if (cache.get(cacheKey)) {
            message.markRead();
            continue;
          }

          let parsedMutationResult = null;
          if (senderLower.includes('jago') || subjectLower.includes('jago') || subjectLower.includes('menerima sejumlah uang')) {
            parsedMutationResult = parseJagoMutationText(emailBody);

            // Kunci Kantong/Rekening Jago: Lewati transfer pribadi ke rekening Jago lain (biarkan tetap unread)
            if (parsedMutationResult && parsedMutationResult.targetAccount &&
                parsedMutationResult.targetAccount !== CONFIG_DEFAULTS.TARGET_JAGO_ACCOUNT) {
              continue;
            }
          } else if (senderLower.includes('bsi') || subjectLower.includes('bsi')) {
            parsedMutationResult = parseBSIMutationText(emailBody);
          }

          cache.put(cacheKey, '1', 21600); // 6 jam

          if (parsedMutationResult && parsedMutationResult.nominalCredit > 0) {
            const matchRes = executeSmartAutoMatching(parsedMutationResult);
            matchedTransactions.push({
              transactionId: matchRes.transactionId,
              amount: parsedMutationResult.nominalCredit,
              sender: parsedMutationResult.senderName,
              bankType: parsedMutationResult.bankType,
              isUnclaimed: !matchRes.matched
            });
            message.markRead();
          }
        }
      }
    }

    return {
      status: matchedTransactions.length > 0 ? 'SUCCESS' : 'NO_NEW_EMAILS',
      matchedCount: matchedTransactions.length,
      matchedTransactions: matchedTransactions,
      message: matchedTransactions.length > 0
        ? 'Berhasil memproses ' + matchedTransactions.length + ' email mutasi Bank Jago.'
        : 'Tidak ada email mutasi Bank Jago baru yang belum dibaca.'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Regex Parser untuk Email Mutasi Bank Syariah Indonesia (BSI)
 */
function parseBSIMutationText(rawEmailContent) {
  // Format BSI Umum:
  // "Telah terjadi transaksi Kredit pada rekening xxxx sebesar Rp 100.342,00. Keterangan: TRANSFER DARI FADLAN ALFIAN"
  let parsedNominal = 0;
  let parsedSender = 'DONATUR BSI';

  const nominalRegexMatches = rawEmailContent.match(/(?:Rp|IDR)\s*([0-9.,]+)/i);
  if (nominalRegexMatches && nominalRegexMatches[1]) {
    parsedNominal = cleanCurrencyToInteger(nominalRegexMatches[1]);
  }

  const senderRegexMatches = rawEmailContent.match(/(?:DARI|PENGIRIM|DARI\s*REKENING|KETERANGAN\s*:?\s*TRANSFER\s*DARI)\s*([A-Za-z0-9\s.,]+?)(?:\.|\n|\r|REK|PADA|$)/i);
  if (senderRegexMatches && senderRegexMatches[1]) {
    parsedSender = senderRegexMatches[1].trim().toUpperCase();
  }

  return {
    bankType: 'BSI_TRANSFER',
    nominalCredit: parsedNominal,
    senderName: parsedSender,
    rawTextExcerpt: rawEmailContent.substring(0, 200)
  };
}

/**
 * Regex Parser untuk Email Mutasi Bank Jago / Jago Syariah (noreply@jago.com)
 * Mendukung format ringkasan transaksi multi-baris maupun format teks satu baris.
 */
function parseJagoMutationText(rawEmailContent) {
  const text = String(rawEmailContent || '');
  let parsedNominal = 0;
  let parsedSender = 'DONATUR BANK JAGO';
  let senderNameOnly = 'DONATUR BANK JAGO';
  let targetAccount = '';
  let targetPocket = '';

  // 1. Ekstrak Nominal: Prioritaskan pola resmi "Jumlah\nRp10.000", lalu pola "sebesar Rp..."
  const jagoSummaryNominal = text.match(/Jumlah\s*[\r\n]*\s*(?:Rp\.?|IDR)\s*([0-9.,]+)/i);
  const inlineNominal = text.match(/(?:uang masuk sebesar|menerima transfer sebesar|sebesar)\s*(?:Rp\.?|IDR)?\s*([0-9.,]+)/i);
  const fallbackNominal = text.match(/(?:Rp\.?|IDR)\s*([0-9.,]+)/i);

  if (jagoSummaryNominal && jagoSummaryNominal[1]) {
    parsedNominal = cleanCurrencyToInteger(jagoSummaryNominal[1]);
  } else if (inlineNominal && inlineNominal[1]) {
    parsedNominal = cleanCurrencyToInteger(inlineNominal[1]);
  } else if (fallbackNominal && fallbackNominal[1]) {
    parsedNominal = cleanCurrencyToInteger(fallbackNominal[1]);
  }

  // 2. Ekstrak Pengirim: Pola resmi Bank Jago ("Dari\nALUMNIDEMOTEST\nBank Syariah Indonesia • 7000000001")
  const dariBlock = text.match(/\bDari\s*[\r\n]+\s*([^\r\n]+)(?:[\r\n]+\s*([^\r\n]+))?/i);
  if (dariBlock && dariBlock[1]) {
    senderNameOnly = dariBlock[1].trim();
    const secondLine = dariBlock[2] ? dariBlock[2].trim() : '';
    if (secondLine && !/^(Ke|Jumlah|Tanggal)\b/i.test(secondLine)) {
      parsedSender = senderNameOnly + ' (' + secondLine + ')';
    } else {
      parsedSender = senderNameOnly;
    }
  } else {
    const inlineSender = text.match(/(?:dari|pengirim)\s+([A-Za-z0-9\s.,]+?)(?:\s+ke\s+kantong|\.|\n|\r|$)/i);
    if (inlineSender && inlineSender[1]) {
      senderNameOnly = inlineSender[1].trim().toUpperCase();
      parsedSender = senderNameOnly;
    }
  }

  // 3. Ekstrak Tujuan Kantong & Nomor Rekening ("Ke\nBEASISWA_DEMO • 500000000001")
  const keBlock = text.match(/\bKe\s*[\r\n]+\s*([^\r\n]+)/i);
  if (keBlock && keBlock[1]) {
    const keLine = keBlock[1].trim();
    const accMatch = keLine.match(/\b(\d{10,14})\b/);
    if (accMatch && accMatch[1]) {
      targetAccount = accMatch[1];
    }
    const pocketMatch = keLine.match(/^([A-Za-z0-9\s_-]+?)\s*[•|·|-]/);
    if (pocketMatch && pocketMatch[1]) {
      targetPocket = pocketMatch[1].trim();
    }
  }

  return {
    bankType: 'TRANSFER_JAGO',
    nominalCredit: parsedNominal,
    senderName: parsedSender,
    senderNameOnly: senderNameOnly,
    targetAccount: targetAccount,
    targetPocket: targetPocket,
    rawTextExcerpt: text.substring(0, 250)
  };
}

function normalizeNameForMatch(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const GENERIC_DONOR_NAMES = {
  hambaallah: true,
  donatur: true,
  donaturbankjago: true,
  donaturbsi: true,
  alumni: true,
  anonim: true,
  unclaimeddonor: true
};

function parseSheetTimestampMs(rawValue) {
  if (rawValue instanceof Date) {
    return rawValue.getTime();
  }
  const str = String(rawValue || '').trim();
  if (!str) return NaN;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(str)) {
    const wibMs = Date.parse(str.replace(' ', 'T') + '+07:00');
    if (!isNaN(wibMs)) return wibMs;
  }
  return Date.parse(str);
}

function isDonorNameMatched(webDonorName, bankSenderName) {
  const donorNorm = normalizeNameForMatch(webDonorName);
  const senderNorm = normalizeNameForMatch(bankSenderName);

  if (!donorNorm || donorNorm.length < 4 || !senderNorm || senderNorm.length < 4) {
    return false;
  }
  if (GENERIC_DONOR_NAMES[donorNorm] || GENERIC_DONOR_NAMES[senderNorm]) {
    return false;
  }
  if (donorNorm === senderNorm) {
    return true;
  }
  if (donorNorm.length >= 6 && senderNorm.length >= 6 &&
      (senderNorm.includes(donorNorm) || donorNorm.includes(senderNorm))) {
    return true;
  }

  const webTokens = String(webDonorName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function(t) { return t.length >= 3; });
  const senderTokens = String(bankSenderName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function(t) { return t.length >= 3; });

  const distinctWebTokens = [];
  for (let i = 0; i < webTokens.length; i++) {
    if (distinctWebTokens.indexOf(webTokens[i]) === -1) {
      distinctWebTokens.push(webTokens[i]);
    }
  }

  if (distinctWebTokens.length >= 2) {
    let overlapCount = 0;
    for (let i = 0; i < distinctWebTokens.length; i++) {
      if (senderNorm.includes(distinctWebTokens[i]) || senderTokens.indexOf(distinctWebTokens[i]) !== -1) {
        overlapCount++;
      }
    }
    if (overlapCount >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Menandai transaksi PENDING yang melewati batas waktu 15 menit sebagai EXPIRED
 */
function expireStalePendingTransactions() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  if (!sheetRawDonations) return { expiredCount: 0 };

  const totalRows = sheetRawDonations.getLastRow();
  if (totalRows <= 1) return { expiredCount: 0 };

  const expiryMs = CONFIG_DEFAULTS.TRANSACTION_EXPIRY_MINUTES * 60 * 1000;
  const nowMs = Date.now();
  const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();
  let expiredCount = 0;

  for (let rowIndex = 0; rowIndex < donationMatrix.length; rowIndex++) {
    const row = donationMatrix[rowIndex];
    const rowStatus = String(row[15] || '').toUpperCase().trim();
    if (!rowStatus.includes('PENDING')) continue;

    const txMs = parseSheetTimestampMs(row[1]);
    if (!isNaN(txMs) && (nowMs - txMs) > expiryMs) {
      const sheetRowNumber = rowIndex + 2;
      sheetRawDonations.getRange(sheetRowNumber, 16).setValue(PAYMENT_STATUS.EXPIRED);
      sheetRawDonations.getRange(sheetRowNumber, 17).setValue('EXPIRED');
      const existingNote = String(row[18] || '').trim();
      if (!existingNote || existingNote === '-') {
        sheetRawDonations.getRange(sheetRowNumber, 19).setValue('Kedaluwarsa otomatis (> 15 menit tanpa mutasi masuk)');
      }
      recordAuditLog(
        'TRANSACTION_AUTO_EXPIRED',
        row[0],
        '',
        'Expired after ' + CONFIG_DEFAULTS.TRANSACTION_EXPIRY_MINUTES + ' minutes.'
      );
      expiredCount++;
    }
  }

  return { expiredCount: expiredCount };
}

/**
 * Helper membersihkan string rupiah menjadi integer murni
 */
function cleanCurrencyToInteger(rawCurrencyString) {
  let cleaned = rawCurrencyString.replace(/\s/g, '');
  // Format Indonesia: 100.342,00 -> pisahkan desimal koma di akhir
  if (cleaned.includes(',')) {
    cleaned = cleaned.split(',')[0];
  }
  cleaned = cleaned.replace(/\./g, '');
  return parseInt(cleaned, 10) || 0;
}

/**
 * Smart Auto-Matching Logic (Zero False Attribution):
 * Tahap 1: PENDING dengan nominal sama persis (> 0)
 * Tahap 2: PENDING nominal 0 (belum kedaluwarsa) dengan kecocokan nama donatur vs pengirim mutasi
 * Jika tidak cocok -> dicatat sebagai UNCLAIMED_DIRECT_TRANSFER (Silent Donor) agar tidak salah atribusi nama
 */
function executeSmartAutoMatching(mutationData) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  const totalRows = sheetRawDonations.getLastRow();

  let matchingRowIndex = -1;
  let matchedRecord = null;
  let matchStage = 'EXACT_NOMINAL';

  if (totalRows > 1) {
    const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();

    // Tahap 1: Exact nominal > 0
    for (let rowIndex = 0; rowIndex < donationMatrix.length; rowIndex++) {
      const rowPaymentStatus = String(donationMatrix[rowIndex][15] || '').toUpperCase().trim();
      const rowTotalAmount = parseInt(donationMatrix[rowIndex][11], 10) || 0;

      if (rowPaymentStatus.includes('PENDING') && rowTotalAmount > 0 && rowTotalAmount === mutationData.nominalCredit) {
        matchingRowIndex = rowIndex + 2;
        matchedRecord = donationMatrix[rowIndex];
        matchStage = 'EXACT_NOMINAL';
        break;
      }
    }

    // Tahap 2: PENDING nominal 0 (aktif <= 15 menit) dengan kecocokan nama pengirim (terbaru ke terlama)
    const candidateSender = mutationData.senderNameOnly || mutationData.senderName;
    const expiryMs = CONFIG_DEFAULTS.TRANSACTION_EXPIRY_MINUTES * 60 * 1000;
    const nowMs = Date.now();
    if (matchingRowIndex === -1) {
      for (let rowIndex = donationMatrix.length - 1; rowIndex >= 0; rowIndex--) {
        const rowPaymentStatus = String(donationMatrix[rowIndex][15] || '').toUpperCase().trim();
        const rowTotalAmount = parseInt(donationMatrix[rowIndex][11], 10) || 0;
        const txMs = parseSheetTimestampMs(donationMatrix[rowIndex][1]);
        const isExpired = !isNaN(txMs) && (nowMs - txMs) > expiryMs;

        if (rowPaymentStatus.includes('PENDING') && rowTotalAmount === 0 && !isExpired &&
            isDonorNameMatched(donationMatrix[rowIndex][4], candidateSender)) {
          matchingRowIndex = rowIndex + 2;
          matchedRecord = donationMatrix[rowIndex];
          matchStage = 'NAME_MATCH_OPEN_NOMINAL';
          break;
        }
      }
    }
  }

  // KONDISI A: COCOK DENGAN TRANSAKSI PENDING WEB
  if (matchingRowIndex !== -1 && matchedRecord) {
    const settlementLabel = mutationData.bankType === 'BSI_TRANSFER' ? 'SETTLED' : 'SETTLED_BANK_JAGO';
    const gatewayNote = 'Auto-verified via Email Bank Jago (' + CONFIG_DEFAULTS.ADMIN_GATEWAY_EMAIL + ') • Rp ' + mutationData.nominalCredit;

    sheetRawDonations.getRange(matchingRowIndex, 10).setValue(mutationData.nominalCredit);
    sheetRawDonations.getRange(matchingRowIndex, 12).setValue(mutationData.nominalCredit);
    sheetRawDonations.getRange(matchingRowIndex, 16).setValue(PAYMENT_STATUS.PAID);
    sheetRawDonations.getRange(matchingRowIndex, 17).setValue(settlementLabel);
    sheetRawDonations.getRange(matchingRowIndex, 18).setValue(mutationData.senderName);
    sheetRawDonations.getRange(matchingRowIndex, 19).setValue(gatewayNote);

    const transactionId = matchedRecord[0];
    const donorName = matchedRecord[4];
    const faculty = matchedRecord[5];

    recordAuditLog(
      'EMAIL_PARSER_AUTO_MATCHED',
      transactionId,
      JSON.stringify(mutationData),
      'Matched [' + matchStage + '] row ' + matchingRowIndex + ' (Nominal: ' + mutationData.nominalCredit + ')'
    );

    if (typeof sendAutomatedNotifications === 'function') {
      sendAutomatedNotifications({
        transactionId: transactionId,
        donorName: donorName,
        faculty: faculty,
        batchYear: matchedRecord[7],
        nominal: mutationData.nominalCredit,
        realAmount: mutationData.nominalCredit,
        uniqueCode: matchedRecord[10],
        paymentChannel: mutationData.bankType,
        validationType: 'Email Gateway Bank Jago (' + CONFIG_DEFAULTS.ADMIN_GATEWAY_EMAIL + ')',
        bankSenderRaw: mutationData.senderName,
        notes: gatewayNote,
        isUnclaimed: false
      });
    }

    sendTelegramNotification(
      '⚡ <b>AUTO-MATCH EMAIL BANK JAGO SUKSES</b>\n' +
      'Order ID: <code>' + transactionId + '</code>\n' +
      'Donatur Web: ' + donorName + ' (' + faculty + ')\n' +
      'Rekening Pengirim: ' + mutationData.senderName + '\n' +
      'Nominal Mutasi: <b>Rp ' + Number(mutationData.nominalCredit).toLocaleString('id-ID') + '</b>\n' +
      'Kanal: ' + mutationData.bankType
    );

    return {
      matched: true,
      transactionId: transactionId,
      status: PAYMENT_STATUS.PAID,
      amount: mutationData.nominalCredit
    };
  }

  // KONDISI B: TIDAK ADA YANG COCOK (SILENT DONOR - TRANSFER LANGSUNG TANPA FORM)
  const currentFormattedDate = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
  const syntheticDirectTxId = 'TX-DIRECT-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900);

  const unclaimedRow = [
    syntheticDirectTxId,
    currentFormattedDate,
    'DIRECT_BANK_TRANSFER',
    '-',
    'UNCLAIMED DONOR (' + (mutationData.senderNameOnly || mutationData.senderName) + ')',
    '-',
    '-',
    '-',
    '-',
    mutationData.nominalCredit,
    0,
    mutationData.nominalCredit,
    mutationData.bankType,
    'PUBLIC',
    VERIFICATION_TIERS.UNCLAIMED_DIRECT_TRANSFER,
    PAYMENT_STATUS.PAID,
    'SETTLED_BANK_JAGO',
    mutationData.senderName,
    'Auto-ingested via Email Bank Jago (' + CONFIG_DEFAULTS.ADMIN_GATEWAY_EMAIL + '). Transfer langsung / nama tidak cocok antrean PENDING (menunggu klaim atau rekonsiliasi admin).',
    ''
  ];

  sheetRawDonations.appendRow(unclaimedRow);

  recordAuditLog(
    'SILENT_DONOR_DIRECT_TRANSFER_INGESTED',
    syntheticDirectTxId,
    JSON.stringify(mutationData),
    'Added to UNCLAIMED_DIRECT_TRANSFER. Amount: ' + mutationData.nominalCredit
  );

  if (typeof sendAutomatedNotifications === 'function') {
    sendAutomatedNotifications({
      transactionId: syntheticDirectTxId,
      donorName: 'UNKNOWN (Silent Donor)',
      faculty: 'Belum Terdata',
      batchYear: '-',
      nominal: mutationData.nominalCredit,
      realAmount: mutationData.nominalCredit,
      paymentChannel: mutationData.bankType,
      validationType: 'Transfer Langsung Rekening Bank Jago',
      bankSenderRaw: mutationData.senderName,
      notes: 'Mutasi Masuk Tanpa Konfirmasi Web (Menunggu Klaim Donatur)',
      isUnclaimed: true
    });
  }

  sendTelegramNotification(
    '⚠️ <b>MUTASI BANK MASUK TANPA WEB FORM (SILENT DONOR)</b>\n' +
    'Direct ID: <code>' + syntheticDirectTxId + '</code>\n' +
    'Nama di Mutasi: ' + mutationData.senderName + '\n' +
    'Nominal: <b>Rp ' + Number(mutationData.nominalCredit).toLocaleString('id-ID') + '</b>\n' +
    'Bank: ' + mutationData.bankType + '\n' +
    'Status: <i>UNCLAIMED_DIRECT_TRANSFER (Muncul di Dasbor Publik untuk Diklaim)</i>'
  );

  return {
    matched: false,
    transactionId: syntheticDirectTxId,
    unclaimedTransactionId: syntheticDirectTxId,
    status: PAYMENT_STATUS.PAID,
    amount: mutationData.nominalCredit
  };
}

/**
 * Handler simulator untuk pengujian mutasi via HTTP POST (Frontend Simulator Drawer)
 */
function handleSimulateBankMutation(simulationPayload) {
  const bankType = simulationPayload.bankType || 'BSI_TRANSFER';
  const nominal = parseInt(simulationPayload.nominalCredit, 10);
  const senderName = simulationPayload.senderName || 'PENGIRIM SIMULASI';

  const mutationMock = {
    bankType: bankType,
    nominalCredit: nominal,
    senderName: senderName,
    rawTextExcerpt: 'Simulated mutation via Admin Testing Panel'
  };

  const matchingResult = executeSmartAutoMatching(mutationMock);

  return {
    status: 'SUCCESS',
    simulationResult: matchingResult
  };
}

// =============================================================================
// 9. MODUL 5: KLAIM DIRECT TRANSFER (UNCLAIMED TRANSFER WIDGET)
// =============================================================================
function handleClaimDirectTransfer(claimPayload) {
  const transactionId = claimPayload.transactionId;
  const claimantName = claimPayload.donorName;
  const faculty = claimPayload.faculty;
  const department = claimPayload.department;
  const batchYear = claimPayload.batchYear;
  const whatsAppNumber = claimPayload.whatsApp;

  if (!transactionId || !claimantName || !faculty) {
    throw new Error('Data klaim donasi tidak lengkap.');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  const totalRows = sheetRawDonations.getLastRow();

  if (totalRows <= 1) {
    throw new Error('Database transaksi kosong.');
  }

  const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();
  let targetRowIndex = -1;

  for (let rowIndex = 0; rowIndex < donationMatrix.length; rowIndex++) {
    if (String(donationMatrix[rowIndex][0]).trim() === String(transactionId).trim()) {
      targetRowIndex = rowIndex + 2;
      break;
    }
  }

  if (targetRowIndex === -1) {
    throw new Error('Transaksi klaim tidak ditemukan.');
  }

  // Update identitas donatur pada baris unclaimed
  if (claimPayload.nim) {
    sheetRawDonations.getRange(targetRowIndex, 4).setValue(String(claimPayload.nim));
  }
  sheetRawDonations.getRange(targetRowIndex, 5).setValue(claimantName);
  sheetRawDonations.getRange(targetRowIndex, 6).setValue(faculty);
  sheetRawDonations.getRange(targetRowIndex, 7).setValue(department || '-');
  sheetRawDonations.getRange(targetRowIndex, 8).setValue(batchYear || '-');
  sheetRawDonations.getRange(targetRowIndex, 9).setValue(whatsAppNumber || '-');
  sheetRawDonations.getRange(targetRowIndex, 15).setValue(claimPayload.verificationTier || 'CLAIMED_DIRECT_TRANSFER');
  sheetRawDonations.getRange(targetRowIndex, 19).setValue(claimPayload.notes || 'Telah diklaim oleh donatur via portal transparansi');

  recordAuditLog('DIRECT_TRANSFER_CLAIMED', transactionId, JSON.stringify(claimPayload), 'Successfully claimed by ' + claimantName);

  return {
    status: 'SUCCESS',
    message: 'Donasi berhasil diklaim dan dicatatkan atas nama angkatan Anda.',
    transactionId: transactionId
  };
}

// =============================================================================
// 10. MODUL 6: KOREKSI NO. WA & DONASI KOLEKTIF (POST-PAYMENT CORRECTION)
// =============================================================================
function handleUpdatePostPaymentInfo(updatePayload) {
  const transactionId = updatePayload.transactionId;
  const updatedWhatsApp = updatePayload.whatsApp;
  const updatedNotes = updatePayload.notes;

  if (!transactionId) {
    throw new Error('Transaction ID diperlukan.');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  const totalRows = sheetRawDonations.getLastRow();

  if (totalRows <= 1) {
    throw new Error('Database transaksi kosong.');
  }

  const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();
  let targetRowIndex = -1;

  for (let rowIndex = 0; rowIndex < donationMatrix.length; rowIndex++) {
    if (String(donationMatrix[rowIndex][0]).trim() === String(transactionId).trim()) {
      targetRowIndex = rowIndex + 2;
      break;
    }
  }

  if (targetRowIndex === -1) {
    throw new Error('Transaksi tidak ditemukan.');
  }

  if (updatedWhatsApp) {
    sheetRawDonations.getRange(targetRowIndex, 9).setValue(updatedWhatsApp);
  }
  if (updatedNotes) {
    sheetRawDonations.getRange(targetRowIndex, 19).setValue(updatedNotes);
  }

  recordAuditLog('POST_PAYMENT_CORRECTION', transactionId, JSON.stringify(updatePayload), 'Updated WhatsApp and Notes');

  return {
    status: 'SUCCESS',
    message: 'Data kontak dan catatan kolektif berhasil diperbarui.',
    transactionId: transactionId
  };
}

// =============================================================================
// 11. MODUL 7: DASBOR TRANSPARANSI PUBLIK BERTINGKAT (UU PDP COMPLIANT)
// =============================================================================
function fetchPublicDashboardMetrics() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);

  const defaultResult = {
    status: 'SUCCESS',
    level1Tracker: {
      totalCollected: 0,
      targetSemester: CONFIG_DEFAULTS.TARGET_SEMESTER_AMOUNT,
      percentage: 0,
      totalDonors: 0,
      lastUpdated: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss')
    },
    level2Leaderboard: [],
    level3CensoredLedger: [],
    level4UnclaimedTransfers: [],
    level5ImpactSummary: {
      totalRecipients: 75,
      recipientsByFaculty: {
        'FPMIPA': 12, 'FPTK': 15, 'FIP': 10, 'FPIPS': 8,
        'FPBS': 9, 'FPEB': 7, 'FPOK': 6, 'FPSD': 5, 'Kamda': 3
      },
      distributedAmount: 120000000
    }
  };

  if (!sheetRawDonations) {
    return defaultResult;
  }

  const totalRows = sheetRawDonations.getLastRow();
  if (totalRows <= 1) {
    return defaultResult;
  }

  const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();

  let totalCollectedAmount = 0;
  let paidDonorCount = 0;
  const facultyAggregation = {};
  const recentTransactionsList = [];
  const unclaimedTransfersList = [];

  for (let index = donationMatrix.length - 1; index >= 0; index--) {
    const row = donationMatrix[index];
    const txId = String(row[0]);
    const timestampStr = String(row[1]);
    const donorName = String(row[4]);
    const faculty = String(row[5]);
    const department = String(row[6]);
    const batchYear = String(row[7]);
    const totalAmount = parseInt(row[11], 10) || 0;
    const paymentChannel = String(row[12]);
    const privacyMode = String(row[13]);
    const verificationTier = String(row[14]);
    const paymentStatus = String(row[15]);
    const senderRaw = String(row[17]);

    const isPaid = paymentStatus.indexOf('PAID') !== -1;

    if (verificationTier === VERIFICATION_TIERS.UNCLAIMED_DIRECT_TRANSFER && isPaid) {
      unclaimedTransfersList.push({
        transactionId: txId,
        timestamp: timestampStr,
        bankChannel: paymentChannel,
        nominal: totalAmount,
        maskedSender: maskPersonalName(senderRaw)
      });
      continue;
    }

    if (isPaid) {
      totalCollectedAmount += totalAmount;
      paidDonorCount++;

      // Agregasi Fakultas untuk Leaderboard
      if (faculty && faculty !== '-') {
        facultyAggregation[faculty] = (facultyAggregation[faculty] || 0) + totalAmount;
      }

      // Live Censored Ledger (UU PDP No. 27/2022 Compliance)
      let publicDisplayName;
      if (privacyMode === 'ANONYMOUS' || donorName.toLowerCase().includes('hamba allah')) {
        publicDisplayName = 'Hamba Allah (' + (faculty !== '-' ? faculty : 'Alumni') + " '" + (batchYear !== '-' ? batchYear.slice(-2) : 'XX') + ')';
      } else {
        publicDisplayName = maskPersonalName(donorName) + (faculty !== '-' ? ' (' + faculty + " '" + (batchYear !== '-' ? batchYear.slice(-2) : '') + ')' : '');
      }

      if (recentTransactionsList.length < 15) {
        recentTransactionsList.push({
          transactionId: txId,
          timestamp: timestampStr,
          displayName: publicDisplayName,
          faculty: faculty,
          department: department,
          batchYear: batchYear,
          nominal: totalAmount,
          paymentChannel: paymentChannel,
          verificationTier: verificationTier,
          status: paymentStatus
        });
      }
    }
  }

  // Format Faculty Leaderboard
  const sortedLeaderboard = Object.keys(facultyAggregation).map(function(facultyName) {
    return {
      faculty: facultyName,
      totalAmount: facultyAggregation[facultyName]
    };
  }).sort(function(itemA, itemB) {
    return itemB.totalAmount - itemA.totalAmount;
  });

  const progressPercentage = Math.min(100, Math.round((totalCollectedAmount / CONFIG_DEFAULTS.TARGET_SEMESTER_AMOUNT) * 1000) / 10);

  return {
    status: 'SUCCESS',
    level1Tracker: {
      totalCollected: totalCollectedAmount,
      targetSemester: CONFIG_DEFAULTS.TARGET_SEMESTER_AMOUNT,
      percentage: progressPercentage,
      totalDonors: paidDonorCount,
      lastUpdated: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss')
    },
    level2Leaderboard: sortedLeaderboard,
    level3CensoredLedger: recentTransactionsList,
    level4UnclaimedTransfers: unclaimedTransfersList,
    level5ImpactSummary: defaultResult.level5ImpactSummary
  };
}

/**
 * Masking nama sesuai kaidah UU Perlindungan Data Pribadi (UU PDP No. 27/2022)
 * Contoh: "MHD FAUZI RACHMAN" -> "MHD FAU***"
 *         "Fadhil Muhammad" -> "Fadhil M.****"
 */
function maskPersonalName(rawName) {
  if (!rawName || rawName === '-' || rawName.toLowerCase() === 'unclaimed donor') {
    return 'Hamba Allah';
  }

  const nameParts = rawName.trim().split(/\s+/);
  if (nameParts.length === 1) {
    const singleWord = nameParts[0];
    if (singleWord.length <= 3) return singleWord + '***';
    return singleWord.substring(0, 3) + '***';
  }

  const firstWord = nameParts[0];
  const secondWord = nameParts[1];
  return firstWord + ' ' + secondWord.substring(0, Math.min(2, secondWord.length)) + '***';
}

/**
 * Polling status transaksi individual oleh frontend
 */
function checkSpecificTransactionStatus(transactionId) {
  if (!transactionId) {
    return { status: 'ERROR', message: 'Transaction ID wajib diisi.' };
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  const totalRows = sheetRawDonations.getLastRow();

  if (totalRows <= 1) {
    return { status: 'NOT_FOUND', message: 'Belum ada transaksi.' };
  }

  const donationMatrix = sheetRawDonations.getRange(2, 1, totalRows - 1, 19).getValues();

  for (let rowIndex = 0; rowIndex < donationMatrix.length; rowIndex++) {
    if (String(donationMatrix[rowIndex][0]).trim() === String(transactionId).trim()) {
      const row = donationMatrix[rowIndex];
      let baseAmount = parseInt(row[9], 10) || 0;
      let totalTransferAmount = parseInt(row[11], 10) || 0;
      const paymentStatus = String(row[15] || '').toUpperCase().trim();

      // Guard: Pastikan nominal tidak pernah 0 jika status sudah PAID
      if (paymentStatus.includes('PAID') && totalTransferAmount <= 0) {
        totalTransferAmount = baseAmount > 0 ? baseAmount : 50000;
        if (baseAmount <= 0) baseAmount = totalTransferAmount;
      }

      return {
        status: 'SUCCESS',
        transactionId: row[0],
        timestamp: row[1],
        donorName: row[4],
        baseAmount: baseAmount,
        uniqueCode: row[10],
        totalTransferAmount: totalTransferAmount,
        realAmount: totalTransferAmount,
        real_amount: totalTransferAmount,
        paymentChannel: row[12],
        verificationTier: row[14],
        paymentStatus: row[15],
        settlementStatus: row[16],
        proofImageUrl: (row.length >= 20 && row[19]) ? String(row[19]) : ""
      };
    }
  }

  return { status: 'NOT_FOUND', message: 'Transaksi ' + transactionId + ' tidak ditemukan.' };
}

/**
 * Mengambil seluruh data transaksi untuk dashboard admin (Sinkronisasi Cloud)
 */
function fetchAllTransactionsForAdmin() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRawDonations = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  if (!sheetRawDonations) {
    return { status: 'SUCCESS', transactions: [] };
  }

  const totalRows = sheetRawDonations.getLastRow();
  if (totalRows <= 1) {
    return { status: 'SUCCESS', transactions: [] };
  }

  const totalCols = Math.max(20, sheetRawDonations.getLastColumn());
  const matrix = sheetRawDonations.getRange(2, 1, totalRows - 1, totalCols).getValues();
  const transactions = [];

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row[0]) continue;
    let proofUrl = "";
    if (row.length >= 20 && row[19]) {
      proofUrl = String(row[19]).trim();
    }
    if (!proofUrl && String(row[18]).includes("drive.google.com")) {
      const matchUrl = String(row[18]).match(/https:\/\/drive\.google\.com[^\s)]+/);
      if (matchUrl) proofUrl = matchUrl[0];
    }

    transactions.push({
      transactionId: String(row[0]),
      timestamp: String(row[1]),
      inflowPath: String(row[2]),
      nim: String(row[3]),
      donorName: String(row[4]),
      faculty: String(row[5]),
      department: String(row[6]),
      batchYear: String(row[7]),
      whatsApp: String(row[8]),
      baseAmount: Number(row[9]) || 0,
      uniqueCode: Number(row[10]) || 0,
      totalTransferAmount: Number(row[11]) || 0,
      paymentChannel: String(row[12]),
      privacyMode: String(row[13]),
      verificationTier: String(row[14]),
      paymentStatus: String(row[15]),
      settlementStatus: String(row[16]),
      bankSenderRaw: String(row[17]),
      notes: String(row[18]),
      proofImageUrl: proofUrl
    });
  }

  return {
    status: 'SUCCESS',
    total: transactions.length,
    transactions: transactions
  };
}


// =============================================================================
// 12. MODUL 8: UPLOAD BUKTI PEMBAYARAN KE GOOGLE DRIVE & AUTO-VERIFIKASI
// =============================================================================
/**
 * Menerima foto screenshot bukti transfer dari donatur, menyimpannya di folder Google Drive,
 * mencatat URL bukti ke spreadsheet, dan memvalidasi status transaksi menjadi PAID.
 */
function handleUploadPaymentProof(payload) {
  const transactionId = payload.transactionId;
  const imageBase64 = payload.imageBase64;
  const mimeType = payload.mimeType || "image/jpeg";

  if (!transactionId) {
    throw new Error("ID Transaksi tidak disertakan.");
  }
  if (!imageBase64) {
    throw new Error("Data gambar bukti pembayaran tidak ditemukan.");
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  if (!sheet) {
    throw new Error("Sheet raw_donations tidak ditemukan.");
  }

  // 1. Simpan gambar ke Google Drive
  let fileUrl = "";
  let fileId = "";
  let uploadError = "";
  try {
    const folderName = "Bukti_Transfer_Beasiswa_UPI";
    let folder;
    const existingFolders = DriveApp.getFoldersByName(folderName);
    if (existingFolders.hasNext()) {
      folder = existingFolders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }
    
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareFolderErr) {
      Logger.log("Folder setSharing note: " + shareFolderErr.message);
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const decodedBytes = Utilities.base64Decode(cleanBase64);
    const fileName = "BUKTI_" + transactionId + "_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd_HHmmss") + ".jpg";
    const blob = Utilities.newBlob(decodedBytes, mimeType, fileName);

    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareFileErr) {
      Logger.log("File setSharing note: " + shareFileErr.message);
    }
    
    fileId = file.getId();
    fileUrl = "https://drive.google.com/file/d/" + fileId + "/view?usp=sharing";
  } catch (driveErr) {
    uploadError = driveErr.message || driveErr.toString();
    Logger.log("Drive upload error: " + uploadError);
    fileUrl = "DRIVE_ERROR: " + uploadError;
  }

  // 2. Pastikan Header Kolom 20 (Proof_Image_Url) ada di sheet
  if (sheet.getLastColumn() < 20) {
    sheet.getRange(1, 20).setValue("Proof_Image_Url")
      .setFontWeight("bold")
      .setBackground("#1E3A8A")
      .setFontColor("#FFFFFF")
      .setHorizontalAlignment("center");
  }

  // 3. Cari baris transaksi di raw_donations
  const lastRow = sheet.getLastRow();
  let targetRowIndex = -1;
  let targetRowData = null;

  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max(20, sheet.getLastColumn())).getValues();
    for (let r = 0; r < data.length; r++) {
      if (String(data[r][0]).trim() === String(transactionId).trim()) {
        targetRowIndex = r + 2; // offset header + 1-based
        targetRowData = data[r];
        break;
      }
    }
  }

  if (targetRowIndex === -1) {
    throw new Error("Transaksi " + transactionId + " tidak ditemukan di database.");
  }

  const baseAmount = parseInt(targetRowData[9], 10) || 0;
  const totalAmount = parseInt(targetRowData[11], 10) || baseAmount;
  const currentStatus = String(targetRowData[15] || 'PENDING');
  const currentSettlement = String(targetRowData[16] || 'UNSETTLED');
  const existingNote = String(targetRowData[18] || '').trim();

  // 4. Arsipkan URL bukti transfer di Kolom 20 tanpa mengubah status pembayaran (tetap menunggu Email Gateway)
  sheet.getRange(targetRowIndex, 20).setValue(fileUrl);
  if (!existingNote || existingNote === '-') {
    sheet.getRange(targetRowIndex, 19).setValue("Arsip bukti transfer diunggah donatur (Google Drive)");
  }

  recordAuditLog("PAYMENT_PROOF_ARCHIVED", transactionId, JSON.stringify({ fileUrl: fileUrl }), "Proof archived without altering payment status (" + currentStatus + ").");

  return {
    status: "SUCCESS",
    message: "Bukti transfer berhasil diarsipkan untuk admin.",
    transactionId: transactionId,
    fileUrl: fileUrl,
    fileId: fileId,
    paymentStatus: currentStatus,
    settlementStatus: currentSettlement,
    baseAmount: baseAmount,
    totalTransferAmount: totalAmount,
    realAmount: totalAmount
  };
}

// =============================================================================
// 13. MODUL 9: AKTIVASI OTORISASI GOOGLE DRIVE & PEMULIHAN AUDIT
// =============================================================================
/**
 * FUNGSI AKTIVASI & OTORISASI GOOGLE DRIVE (AKUN GATEWAY)
 * -----------------------------------------------------------------------------
 * Jalankan fungsi ini 1x langsung dari Editor Apps Script (klik tombol "Jalankan"):
 * 1. Toolbar atas: Pilih "testOtorisasiGoogleDrive"
 * 2. Klik "Jalankan" (Run)
 * 3. Dialog "Authorization Required" (Otorisasi Diperlukan) akan muncul
 * 4. Klik "Tinjau Izin" -> Pilih akun gateway Anda -> "Lanjutan" -> "Buka Database Donasi Alumni (tidak aman)" -> "Izinkan"
 * 5. Update Web App Deployment: Klik "Terapkan" -> "Kelola penerapan" -> Edit (pensil) -> Versi baru -> Terapkan.
 */
function testOtorisasiGoogleDrive() {
  const folderName = "Bukti_Transfer_Beasiswa_UPI";
  let folder;
  const existingFolders = DriveApp.getFoldersByName(folderName);
  if (existingFolders.hasNext()) {
    folder = existingFolders.next();
    Logger.log("[OK] Folder ditemukan: " + folder.getUrl());
  } else {
    folder = DriveApp.createFolder(folderName);
    Logger.log("[OK] Folder baru berhasil dibuat: " + folder.getUrl());
  }

  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Buat file tes verifikasi hak akses baca/tulis
  const testBlob = Utilities.newBlob("Tes otorisasi Google Drive sukses pada: " + new Date().toISOString(), "text/plain", "TEST_AUTH_DRIVE.txt");
  const testFile = folder.createFile(testBlob);
  testFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const testFileUrl = testFile.getUrl();
  testFile.setTrashed(true); // Hapus file tes ke sampah

  Logger.log("=================================================================");
  Logger.log("🎉 OTORISASI GOOGLE DRIVE BERHASIL UNTUK AKUN GATEWAY");
  Logger.log("Folder Penyimpanan Bukti: " + folder.getUrl());
  Logger.log("=================================================================");

  return {
    status: "SUCCESS",
    message: "Google Drive terotorisasi dengan sukses!",
    folderUrl: folder.getUrl()
  };
}

/**
 * Utility opsional untuk membersihkan teks pesan error Drive pada Google Sheets
 * Mengubah pesan DRIVE_ERROR di kolom T menjadi catatan rapi "Menunggu Re-upload Bukti"
 */
function bersihkanPesanDriveErrorSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAMES.RAW_DONATIONS);
  if (!sheet) return "Sheet tidak ditemukan";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "Tidak ada data transaksi";

  const data = sheet.getRange(2, 20, lastRow - 1, 1).getValues();
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const val = String(data[i][0] || '');
    if (val.startsWith("DRIVE_ERROR:")) {
      sheet.getRange(i + 2, 20).setValue("-");
      sheet.getRange(i + 2, 19).setValue("Verifikasi Web (Drive Belum Terotorisasi Saat Upload)");
      count++;
    }
  }

  return "Berhasil memperbarui " + count + " baris yang memiliki teks error Drive.";
}

