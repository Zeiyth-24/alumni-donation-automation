/**
 * KONFIGURASI SANDBOX / PORTFOLIO SISTEM BEASISWA IKA UPI
 * File ini dipanggil oleh index.html saat pertama kali dimuat.
 *
 * Ganti placeholder GAS_DEPLOYMENT_URL dan rekening tujuan dengan endpoint
 * Google Apps Script milik lembaga Anda sebelum deploy ke production.
 */
window.APP_CONFIG = {
  // 1. URL Deployment Google Apps Script Web App (akhiran /exec)
  GAS_DEPLOYMENT_URL: 'https://script.google.com/macros/s/YOUR_GAS_DEPLOYMENT_ID/exec',

  // 2. URL Embed Report Google Looker Studio
  LOOKER_STUDIO_EMBED_URL: '',

  // 3. URL Spreadsheet Google Sheets (Buku Kas & Mutasi)
  GOOGLE_SHEETS_URL: '',

  // 4. Default Mode Operasi saat aplikasi pertama kali dibuka (true = Sandbox Demo Mode aktif)
  DEFAULT_DEMO_MODE: true,

  // 5. Target Pengumpulan Donasi Beasiswa Semester Berjalan (Rupiah)
  TARGET_SEMESTER_AMOUNT: 50000000,

  // 6. Rekening Resmi Kas Yayasan / Lembaga Beasiswa IKA UPI (Sandbox Placeholder)
  BANK_ACCOUNTS: {
    JAGO: {
      BANK_NAME: 'Bank Jago Syariah (Sandbox)',
      ACCOUNT_NUMBER: '500000000001',
      ACCOUNT_NUMBER_DISPLAY: '5000 0000 0001',
      ACCOUNT_HOLDER: 'Lembaga Beasiswa IKA UPI (Sandbox)',
      POCKET_NAME: 'BEASISWA_DEMO'
    },
    BSI: {
      BANK_NAME: 'Bank Syariah Indonesia (BSI)',
      ACCOUNT_NUMBER: '7188000001',
      ACCOUNT_NUMBER_DISPLAY: '7188 000 001',
      ACCOUNT_HOLDER: 'Lembaga Beasiswa IKA UPI (Sandbox)'
    }
  }
};

