# Alumni Donation Automation — Governance-First Webhook Verification & Google Sheets Ledger

Automated donation verification, webhook/email mutation ingestion, and public transparency portal for **Lembaga Beasiswa Ikatan Alumni (`IKA UPI`)**.

Designed to eliminate operational bottlenecks when **operational scholarship managers do not hold Treasurer bank credentials**, capture unconfirmed direct transfers (**"Silent Donors"**), reconcile multi-bank policies (**Bank Jago Syariah, BSI, Mandiri, BCA, BNI, BRI**), and stream verified receipts directly into **Google Sheets** in real time.

> [!IMPORTANT]
> **Public Repository & Sandbox Notice**
> All endpoint URLs, email addresses, QRIS merchant strings, bank pocket accounts (`500000000001`, `7188000001`), and admin credentials in this repository are **sanitized sandbox placeholders**. Production secrets (Google Apps Script URLs, Gmail gateway filters, and notification recipients) are configured solely via runtime configuration (`ScriptProperties` / externalized `config.js`) outside version control.
>
> Companion Architecture Decision Record (ADR): [`Zeiyth-24/qris-dynamic-injection-compliance-adr`](https://github.com/Zeiyth-24/qris-dynamic-injection-compliance-adr) — documents why static QRIS presentation paired with bank-verified webhooks is safer than client-side QR payload injection.

---

## 1. Domain Context & Problem Statement

Alumni scholarship foundations (`Ikatan Alumni UPI`) rely heavily on community trust and agile coordination across two distinct roles:

1. **Treasurer (`Bendahara`)** — legally and security-wise the sole custodian of organizational bank accounts and direct internet-banking credentials.
2. **Operational Scholarship Managers (`Pengelola Operasional`)** — responsible for donor outreach, cohort engagement, verifying incoming pledges, publishing scholarship progress, and issuing donor confirmations.

### Core Operational Pain Points
- **Silent Donors (Unconfirmed Transfers):** Alumni frequently transfer funds or scan a static QRIS directly without submitting confirmation forms or uploading receipts.
- **Credential Segregation Bottleneck:** Operational managers **must not** be given the Treasurer's mobile/web banking logins, yet historically had to message the Treasurer manually (`"Did Rp 250.000 arrive from Budi?"`) for every single pledge.
- **Multi-Bank Policy Fragmentation:** Partner banks (**BSI**, **Bank Jago Syariah**, plus donor originating banks across **Mandiri**, **BCA**, **BNI**, **BRI**) expose vastly different notification/webhook policies (email alerts, institutional Open APIs / SNAP BI, e-wallet QRIS push notices), making unified real-time bookkeeping brittle.
- **Lagged Ledgers Erode Donor Trust:** Delayed or unverified fundraising totals discourage repeat alumni contributions.

### Project Objectives
- **Credential-Free Automated Verification:** Enable operational managers to confirm incoming donations instantaneously via automated webhook/email mutation parsing **without touching Treasurer banking credentials**.
- **Single Source of Truth in Google Sheets:** Ingest every settled donation payload automatically into structured spreadsheet ledgers (`raw_donations`, `audit_logs`, `master_alumni`).
- **Progressive Donor Trust Architecture:** Present verifiable organizational metadata pre-payment, enforce bank-truth nominal attribution (zero self-declared amount trust), and publish privacy-safe live fundraising transparency.

---

## 2. Baseline Analysis (Manual vs. Automated Flow)

### Baseline Manual Workflow (`Before`)
```text
[Alumni Donor] ──(Transfer / QRIS, often no confirm)──▶ [Bank Account (BSI / Bank Jago)]
                                                                   │
                                                    (Sole Access Credential)
                                                                   ▼
[Google Sheets Ledger] ◀──(Delayed Manual Input)── [Operational Manager] ◀──(Manual Chat Check)── [Treasurer / Bendahara]
```

| Bottleneck Dimension | Baseline Manual Process | Automated Webhook & Sheets System |
| :--- | :--- | :--- |
| **Confirmation Latency** | Hours to days (depends on Treasurer availability) | Near real-time (~1 min polling trigger / instant webhook) |
| **Credential Exposure** | Temptation to share bank login screenshots | **Zero bank login sharing** — isolated read-only notification feed |
| **Silent Donor Handling** | Unconfirmed funds sit unidentified ("dana tak bertuan") | Auto-ingested as `UNCLAIMED_DIRECT_TRANSFER` (`TX-DIRECT-*`) for reconciliation |
| **Nominal Integrity** | Vulnerable to self-reported form amounts | **Bank-truth override**: amount written strictly from verified bank mutation |
| **Multi-Bank Visibility** | Scattered across BSI, Jago, and QRIS apps | Unified JSON schema normalized into `raw_donations` |

---

## 3. Priority: Multi-Bank Webhook & Email-Gateway Architecture

Because Indonesian banks enforce strict authentication boundaries and do not offer uniform push webhooks to retail/community foundation accounts without enterprise SNAP BI onboarding, this system adopts a **dual-ingestion adapter architecture**:

```text
                        ┌─────────────────────────────────────────┐
                        │        DONOR PORTAL (dist_donatur)      │
                        │  • Alumni SIAK Lookup / Express Flow    │
                        │  • Static Verified QRIS & Bank Pocket   │
                        │  • Optional Receipt Proof -> DriveApp   │
                        └────────────────────┬────────────────────┘
                                             │ Create PENDING Intent
                                             ▼
┌───────────────────┐   Webhook / Email  ┌─────────────────────────────────────────┐
│ Multi-Bank Feeds  │ ─────────────────▶ │   GOOGLE APPS SCRIPT GATEWAY (Code.gs)  │
│ • Bank Jago Email │                    │  • doPost Webhook + 1-min Gmail Trigger │
│ • BSI Credit Alert│                    │  • Anti-Loop & Target Pocket Filtering  │
│ • DANA QRIS Email │                    │  • Zero False Attribution Name Matcher  │
│ • SNAP BI Webhook │                    │  • 15-min Auto-Expiry & Audit Logger    │
└───────────────────┘                    └──────────┬──────────────────┬───────────┘
                                                    │                  │
                                    Auto-Append /   │                  │ Automated Alert
                                    Settle Rows     ▼                  ▼ (Notification.gs)
                                         ┌─────────────────┐  ┌────────────────────┐
                                         │  GOOGLE SHEETS  │  │ ADMIN PORTAL       │
                                         │  • raw_donations│  │ (dist_admin)       │
                                         │  • master_alumni│  │ • 1:1 Cloud Sync   │
                                         │  • audit_logs   │  │ • Silent Claiming  │
                                         └─────────────────┘  └────────────────────┘
```

### Multi-Bank Policy & Integration Matrix

| Bank / Channel | Current Reality / Bank Policy | Ingestion Mechanism Implemented & Planned | Treasurer Credentials Needed by Ops? |
| :--- | :--- | :--- | :--- |
| **Bank Jago Syariah** | Sends structured plaintext/HTML transaction alert emails per Kantong/Pocket (`noreply@jago.com`) with sender name, bank, pocket account number, nominal, and WIB timestamp | **Implemented (`parseJagoMutationText`):** 1-minute Gmail trigger + target pocket/account filter (`TARGET_JAGO_ACCOUNT`) so non-foundation personal pockets are ignored | **No** — Treasurer simply enables email notifications to an isolated gateway alias |
| **Bank Syariah Indonesia (BSI)** | Institutional cash-management notifications / email credit advices (`CR TRANSFER ... NOMINAL ...`) | **Implemented (`parseBankMutasiEmails`):** Regex nominal & credit parser + `doPost` webhook handler | **No** — Uses filtered notification forwarder / webhook relay |
| **DANA / QRIS Merchant** | Merchant notification emails on static QRIS settlements | **Implemented (`scanGmailAndGenerateReceipts`):** Real-amount extraction & anti-loop guard | **No** — Read-only settlement email scope |
| **Mandiri, BCA, BNI, BRI** | Diverse policies: Corporate API / SNAP BI (RSA-SHA256 + OAuth2), Virtual Account callbacks, or bank-statement webhooks (KlikBCA Bisnis, Kopra, BRIAPI, BNIdirect) | **Planned Phase 3 Normalizer:** Lightweight webhook relay maps bank-specific JSON payloads to `{ bankType, nominalCredit, senderName, targetAccount }` before calling `executeSmartAutoMatching()` | **No** — Institutional webhook tokens stay isolated in secret manager |

### Safeguards Against Misattribution (`Zero False Attribution`)
When multiple alumni pay around the same time or a static QRIS receives concurrent transfers:
1. **Strict Target Account Filter:** Bank Jago emails whose target account does not match `CONFIG_DEFAULTS.TARGET_JAGO_ACCOUNT` are discarded before touching the ledger.
2. **Sender-Name Matching (`isDonorNameMatched`):** Compares normalized web donor names against the bank sender string (`ALUMNI...` / `BUDI...`) while **explicitly blocking generic labels** such as `"Hamba Allah"` from fuzzy auto-matching.
3. **15-Minute `PENDING` Window (`expireStalePendingTransactions`):** Expired intents flip to `EXPIRED`, preventing stale form submissions from hijacking later incoming transfers.
4. **Silent Donor Capture (`UNCLAIMED_DIRECT_TRANSFER`):** Unmatched verified incoming transfers are appended as `TX-DIRECT-*` with `Payment_Status = PAID`, preserving 100% cash reconciliation accuracy and allowing admins to claim/attribute them in `dist_admin`.

---

## 4. Building Donor Trust: Step-by-Step Transparency Model

To sustain long-term alumni trust while protecting individual privacy (PDPA / UU PDP compliance), the portal presents different tiers of data at each stage:

1. **Step 1 — Verified Pre-Transfer Identity (`What the Donor Verifies`):**
   - Official foundation merchant name, city, NMID, and dedicated pocket label (`BANK_ACCOUNTS`) are displayed verbatim alongside the static QRIS / account copy box so donors can verify destination ownership inside their banking app *before* hitting send.
2. **Step 2 — Bank-Verified Nominal & Proof Archive (`Tamper-Resistant Recording`):**
   - The UI removes arbitrary self-reported nominal overrides for receipt approval; settled amounts come strictly from bank mutation data, while optional screenshot uploads go to Google Drive (`DriveApp`) strictly as an admin archive (`proofImageUrl`).
3. **Step 3 — Privacy-Preserving Public Ledger (`dist_donatur`):**
   - Donors toggle `PUBLIC` vs `ANONYMOUS` (`"Hamba Allah"`). Even on public dashboards, NIM, WhatsApp, and bank sender raw strings remain filtered out—exposing only aggregated fundraising progress (`Rp collected vs Target`), cohort faculty participation, and anonymized/consented acknowledgment.
4. **Step 4 — Immutable Operational Audit Trail (`audit_logs` & `dist_admin`):**
   - Operational managers inspect unmatched `UNCLAIMED_DIRECT_TRANSFER` rows, manual override notes, and webhook ingest events inside the admin portal synced 1:1 with Google Sheets.

---

## 5. Google Sheets Ledger Schema

Created automatically by `Seeder.gs` (`setupDatabaseSheets()`):

### Tab 1: `raw_donations` (20 Columns)
| Col | Header | Description |
| :--- | :--- | :--- |
| A | `Transaction_ID` | Unique ID (`TX-*` web intent or `TX-DIRECT-*` silent donor) |
| B | `Timestamp` | WIB timestamp (`yyyy-MM-dd HH:mm:ss`) |
| C | `Inflow_Path` | `PATH_1_VERIFIED`, `PATH_2_SENIOR`, `PATH_3_EXPRESS`, `DIRECT_BANK_MUTATION` |
| D–I | `NIM` .. `WhatsApp` | Donor academic metadata (sanitized / optional on express path) |
| J–L | `Base_Amount`, `Unique_Code`, `Total_Transfer_Amount` | Settled amount written/overridden from bank mutation truth |
| M | `Payment_Channel` | `QRIS`, `QRIS_DANA`, `TRANSFER_JAGO`, `BSI_TRANSFER` |
| N–O | `Privacy_Mode`, `Verification_Tier` | `PUBLIC` / `ANONYMOUS` & tier (`TIER_1_VERIFIED` .. `UNCLAIMED_DIRECT_TRANSFER`) |
| P–Q | `Payment_Status`, `Settlement_Status` | `PENDING` / `PAID` / `EXPIRED` & channel settlement tag |
| R–S | `Bank_Sender_Raw`, `Notes` | Normalized sender bank string & system audit notes |
| T | `Proof_Image_URL` | Google Drive archive URL (when uploaded by donor) |

### Tab 2 & 3: `master_alumni` & `audit_logs`
- `master_alumni`: Indexed alumni lookup registry (`NIM`, Name, Faculty, Department, Cohort Year).
- `audit_logs`: Append-only event log (`Timestamp`, `Event_Type`, `Target_ID`, `Raw_Payload`, `Result`).

---

## 6. Phased Solution Roadmap

| Phase | Milestone | Key Deliverables |
| :--- | :--- | :--- |
| **Phase 1** *(Complete)* | **Webhook & Email Gateway Engine** | `parseJagoMutationText`, `parseBankMutasiEmails`, `doPost` JSON webhook receiver, anti-loop guards, Node VM test suite (`12/12` passing) |
| **Phase 2** *(Complete)* | **Google Sheets Schema & Dual-Site Segregation** | 20-column `raw_donations` + `audit_logs` auto-seeder, `Zero False Attribution` matching, 15-min expiry, `build_dist.js` enforcing zero cross-links between `dist_donatur` & `dist_admin` |
| **Phase 3** *(Roadmap)* | **Multi-Bank SNAP BI / Commercial Webhook Adapter** | Serverless webhook normalizer (`Mandiri`, `BCA`, `BNI`, `BRI`) with HMAC-SHA256 / asymmetric signature verification forwarding normalized credit events to Apps Script |
| **Phase 4** *(Roadmap)* | **Public Transparency BI & Scholarship Disbursement** | Looker Studio embed on public portal (`LOOKER_STUDIO_EMBED_URL`), cohort heatmaps, and scholarship recipient disbursement tracking linked to settled funds |

---

## 7. Repository Structure

```text
alumni-donation-automation/
├── Code.gs               # Google Apps Script backend: doGet/doPost webhooks, Gmail parsers, smart matcher, Drive upload
├── Notification.gs       # Automated HTML email alerts & receipts to managers without exposing bank accounts
├── Seeder.gs             # Google Sheets schema bootstrapper & 5 representative case fixtures
├── appsscript.json       # GAS V8 manifest & least-privilege OAuth scopes
├── config.js             # Externalized runtime config (sandbox defaults in repo; swap GAS URL for production)
├── seed_data.js          # Client sandbox fixture dataset mirroring the 5 Google Sheets lifecycle states
├── styles.css            # Shared visual design system tokens
├── netlify.toml          # Dual-site static hosting headers & SPA rules
├── build_dist.js         # Syncs shared assets to dist_donatur/ & dist_admin/ and validates role segregation
├── test_system.js        # 12 automated verification tests (regex, CRC-16 QRIS, GAS VM matcher, zero false attribution)
├── dist_donatur/         # Public donor portal (zero links to admin)
├── dist_admin/           # Internal reconciliation & cloud-sync dashboard (zero links to donor portal)
└── assets/               # UI logos & Aptos typography assets
```

---

## 8. Quick Verification & Setup

### Run Local Build & Automated Test Suite (Node.js)
No external npm packages are required (standard Node.js built-ins only):

```bash
# 1. Sync shared assets and validate dual-site segregation rules
node build_dist.js

# 2. Run all 12 automated tests (Regex Parsers, EMVCo CRC-16, GAS VM Smart Matcher, Expiry)
node test_system.js
```

### Deploy Backend to Google Workspace (Production)
1. Create a Google Sheet and open **Extensions -> Apps Script**.
2. Copy `Code.gs`, `Notification.gs`, `Seeder.gs`, and `appsscript.json`.
3. Run `setupDatabaseSheets()` once to generate `raw_donations`, `master_alumni`, and `audit_logs`.
4. Set Apps Script **Script Properties** (`MANAGER_EMAIL`, etc.) and deploy as a **Web App** (`Execute as: Me`, `Who has access: Anyone`).
5. Run `setupEmailGatewayTrigger()` once inside the Apps Script editor to start the 1-minute bank notification scanner.
6. Update `config.js` with your live `GAS_DEPLOYMENT_URL`, real foundation accounts, and `DEFAULT_DEMO_MODE: false`, then deploy `dist_donatur/` and `dist_admin/` as separate static sites (e.g., Netlify).

---

## License

MIT License — see [LICENSE](./LICENSE).
