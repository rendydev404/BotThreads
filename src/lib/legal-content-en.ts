/**
 * Terjemahan bahasa Inggris dokumen legal (struktur sama persis dengan ./legal-content.ts).
 * Dimuat lewat import dinamis hanya saat bahasa = EN, jadi tidak ikut bundel pengguna ID.
 * Aturan: terjemahkan maknanya apa adanya. Kewajiban, angka, tanggal, nama perusahaan, alamat, email, telepon,
 * dan rujukan hukum tidak boleh ditambah, dikurangi, atau dilunakkan. Bila teks Indonesia berubah, ubah juga di sini.
 */

import { MERCHANT_INFO, type LegalDocId, type LegalDocument } from "./legal-content";

type MerchantInfo = { readonly [K in keyof typeof MERCHANT_INFO]: string };

/** Identitas merchant versi EN: data kontak & alamat sama persis; hanya teks deskriptif yang diterjemahkan. */
export const MERCHANT_INFO_EN: MerchantInfo = {
  ...MERCHANT_INFO,
  unitName: "BotThreads Indonesia Service Unit",
  tagline: "AI-powered content autopilot, scheduling, and analytics for Meta Threads accounts.",
  operatingHours: "Monday – Saturday, 09.00 – 18.00 WIB",
  currency: "Indonesian Rupiah (IDR / Rp)",
  effectiveDate: "October 2, 2026",
};

const M = MERCHANT_INFO_EN;

export const LEGAL_DOCUMENTS_EN: Record<LegalDocId, LegalDocument> = {
  privasi: {
    id: "privasi",
    order: "01",
    href: "/kebijakan-privasi",
    shortTitle: "Privacy Policy",
    category: "PERSONAL DATA PROTECTION",
    title: "Privacy Policy",
    subtitle:
      "How BotThreads collects, encrypts, and processes account data, official Meta Threads & Google API authorizations, and customer transaction information.",
    effectiveDate: M.effectiveDate,
    docCode: "BT-DOC/PP-01",
    jurisdiction: "UU No. 27 Tahun 2022 (UU PDP) (Law No. 27 of 2022 on Personal Data Protection)",
    summarySpecs: [
      { term: "Authorization Method", detail: "Official Meta Threads API OAuth 2.0 & Google Sign-In (social media passwords are not stored)" },
      { term: "Token Storage", detail: "Encrypted at the server level (AES-256) and isolated per workspace" },
      { term: "Payment Data", detail: "Processed directly by Midtrans; we do not store card numbers or bank PINs" },
      { term: "Sale of Data", detail: "We never sell, rent, or share data with third-party advertisers" },
    ],
    articles: [
      {
        id: "pendahuluan",
        index: "01",
        title: "Scope and Regulatory Compliance",
        paragraphs: [
          "This Privacy Policy governs how BotThreads collects, uses, stores, and protects users' personal information and operational data when they use our software services.",
          "This policy is prepared in accordance with Law of the Republic of Indonesia Number 27 of 2022 on Personal Data Protection (UU PDP), the Law on Electronic Information and Transactions (UU ITE), and the official developer requirements of Meta Platforms, Inc. and Google LLC.",
        ],
      },
      {
        id: "data-dikumpulkan",
        index: "02",
        title: "Data We Collect",
        paragraphs: [
          "We only collect data that is functionally required to provide the AI writing, automated scheduling, performance analytics, and subscription billing management features:",
        ],
        rows: [
          {
            term: "Account Identity",
            detail: "Display name, email address, username, member role within the workspace, and a one-way password hash.",
          },
          {
            term: "Meta & Google Authorization",
            detail: "Threads user ID, username, profile name, permission scopes, encrypted access tokens from the official Meta Threads API, and the verified email address from Google OAuth.",
          },
          {
            term: "Brand Content & Knowledge",
            detail: "Product facts, price lists, active promotions, banned words, post drafts, publishing schedules, and view metrics (views, likes, replies) from your own Threads accounts.",
          },
          {
            term: "Transaction Records",
            detail: "Invoice number (Order ID), subscription plan, duration cycle, payment method (QRIS, E-Wallet, Virtual Account), time of payment, and amount in Rupiah (IDR).",
          },
        ],
      },
      {
        id: "tujuan-pemrosesan",
        index: "03",
        title: "Purposes of Data Use",
        paragraphs: [
          "All information collected is processed solely to carry out user instructions within the application:",
        ],
        rows: [
          {
            term: "Scheduled Publishing",
            detail: "Composing drafts based on your brand knowledge base, checking compliance with quality rules, and publishing posts to Threads at the selected publishing times.",
          },
          {
            term: "Account Performance Calibration",
            detail: "Calculating peak hours and identifying the topic patterns with the highest views specifically for your account, without mixing it with other customers' data.",
          },
          {
            term: "Billing Verification",
            detail: "Issuing payment codes through the Midtrans Core API, automatically validating settlement, and activating plan quotas in the workspace.",
          },
          {
            term: "Security & Audit",
            detail: "Recording the history of important configuration changes within the workspace to prevent unauthorized access.",
          },
        ],
      },
      {
        id: "keamanan-data",
        index: "04",
        title: "Infrastructure Security and Multi-Tenant Isolation",
        paragraphs: [
          "Each workspace operates within data isolation boundaries enforced directly at the server and database level:",
        ],
        rows: [
          {
            term: "Credential Encryption",
            detail: "Meta Threads access tokens are encrypted with a server cryptographic key before being stored and are never displayed again in plain text.",
          },
          {
            term: "Role-Based Access Control",
            detail: "Read and write rights are strictly limited based on member roles (Owner, Admin, Editor, Viewer) and the list of permitted Threads accounts.",
          },
          {
            term: "Webhook Validation",
            detail: "Payment notifications are verified using a SHA-512 signature and re-confirmed with the official Midtrans endpoint.",
          },
        ],
      },
      {
        id: "pihak-ketiga",
        index: "05",
        title: "Third-Party Infrastructure Partners",
        paragraphs: [
          "We only pass data, on a limited basis, to the core infrastructure providers required for the service to operate:",
        ],
        rows: [
          {
            term: "Midtrans",
            detail: "An official payment gateway operator licensed by Bank Indonesia, used to process QRIS, GoPay, ShopeePay, and bank Virtual Account transactions.",
          },
          {
            term: "Meta Platforms, Inc.",
            detail: "Provider of the official Threads API for publishing posts and retrieving analytics metrics for the accounts you have connected.",
          },
          {
            term: "Google Cloud",
            detail: "Provider of Google Sign-In authentication and natural language model processing for drafting content.",
          },
        ],
      },
    ],
  },

  ketentuan: {
    id: "ketentuan",
    order: "02",
    href: "/syarat-ketentuan",
    shortTitle: "Terms & Conditions",
    category: "SERVICE USE AGREEMENT",
    title: "Terms & Conditions of Service",
    subtitle:
      "The legal terms for using the BotThreads SaaS platform, the rights and obligations of workspace owners, content compliance rules, and subscription terms.",
    effectiveDate: M.effectiveDate,
    docCode: "BT-DOC/TC-02",
    jurisdiction: "Laws of the Republic of Indonesia",
    summarySpecs: [
      { term: "Service Model", detail: "Web-based software (SaaS) for Threads content automation and analytics" },
      { term: "Billing Currency", detail: "All plan prices are listed and billed in Indonesian Rupiah (IDR)" },
      { term: "Billing Mechanism", detail: "Prepaid per cycle (1, 3, or 12 months) with no automatic balance deduction" },
      { term: "Publishing Control", detail: "Supports both Review First (manual) and Automatic modes, plus an instant pause button" },
    ],
    articles: [
      {
        id: "ketentuan-umum",
        index: "01",
        title: "Definitions and Acceptance of Terms",
        paragraphs: [
          "BotThreads is a cloud-based software service that helps business owners, creators, and brand management teams plan ideas, write AI-based drafts, schedule publishing times, and analyze the performance of Meta Threads accounts.",
          "By creating an account, accessing a workspace, or paying for a subscription plan, you declare that you have read, understood, and agreed to the entire contents of these Terms & Conditions.",
        ],
      },
      {
        id: "akun-dan-tim",
        index: "02",
        title: "User Accounts, Security, and Workspace Authority",
        paragraphs: [
          "Users must provide accurate registration information and keep their respective login credentials confidential:",
        ],
        rows: [
          {
            term: "Workspace Ownership",
            detail: "Self-registered users automatically become the Owner of the new workspace they create.",
          },
          {
            term: "Threads Account Authority",
            detail: "You warrant that every Threads account connected to the workspace is lawfully owned by your organization or has received official permission.",
          },
          {
            term: "Session Responsibility",
            detail: "All scheduling actions or settings changes made through a valid account are the responsibility of that account holder.",
          },
        ],
      },
      {
        id: "kepatuhan-konten",
        index: "03",
        title: "Content Rules and Prohibited Uses",
        paragraphs: [
          "Our system provides automated checking gates (validation of price/promotion claims against the knowledge base, a list of banned words, and AI editor scoring). However, final responsibility for the accuracy of product information remains with the user.",
          "Users are prohibited from using the BotThreads service to produce or distribute content containing:",
        ],
        rows: [
          {
            term: "Fraud & Hoaxes",
            detail: "False product claims, financial fraud schemes, illegal investments, or manipulation of public information.",
          },
          {
            term: "Illegal Content",
            detail: "Online gambling, pornography, extortion, or trade in goods/services prohibited under the laws of the Republic of Indonesia.",
          },
          {
            term: "Rights Violations & SARA",
            detail: "Hate speech based on SARA (ethnicity, religion, race, and inter-group relations), defamation, or infringement of third-party intellectual property rights.",
          },
          {
            term: "API Abuse",
            detail: "Mass spam, attempts to hack the infrastructure, or violations of the Meta Threads Terms of Use.",
          },
        ],
      },
      {
        id: "pembayaran-langganan",
        index: "04",
        title: "Pricing, Subscription Cycles, and Payment",
        paragraphs: [
          "Feature capacity within the workspace is determined by the active subscription plan chosen by the Owner or Admin:",
        ],
        rows: [
          {
            term: "Rupiah Pricing (IDR)",
            detail: "All plan rates are displayed transparently in Indonesian Rupiah (IDR) on the Pricing & Plans page.",
          },
          {
            term: "Cycle Options",
            detail: "Subscription periods of 1 month (30 days), 3 months (90 days, save 10%), and 12 months (360 days, save 20%) are available.",
          },
          {
            term: "Payment Channels",
            detail: "Payments are officially processed through the Midtrans Core API using QRIS, GoPay, ShopeePay, or national bank Virtual Accounts.",
          },
          {
            term: "End of Active Period",
            detail: "If the plan's active period ends, autopilot publishing stops temporarily until the plan is renewed, but all history and analytics data remain accessible.",
          },
        ],
      },
      {
        id: "batasan-tanggung-jawab",
        index: "05",
        title: "Service Availability and Limitation of Liability",
        paragraphs: [
          "BotThreads is equipped with automatic safety mechanisms, including automatically pausing an account if publishing fails three times in a row and downgrading to Review First mode if weekly views drop sharply.",
          "Users understand that final publishing to social media depends on the availability of the official API of Meta Platforms, Inc. BotThreads is not responsible for server-side disruptions at Meta, account restrictions imposed by Meta, or changes in third-party policies.",
        ],
      },
    ],
  },

  pengembalian: {
    id: "pengembalian",
    order: "03",
    href: "/kebijakan-pengembalian",
    shortTitle: "Refund Policy",
    category: "REFUNDS & CANCELLATIONS",
    title: "Refund & Cancellation Policy",
    subtitle:
      "Terms for self-service invoice cancellation, stopping subscription renewal without penalty, and the requirements and procedure for requesting a refund.",
    effectiveDate: M.effectiveDate,
    docCode: "BT-DOC/RF-03",
    jurisdiction: "Midtrans Transaction Standards & Consumer Protection",
    summarySpecs: [
      { term: "Invoice Cancellation", detail: "Can be cancelled at any time before payment, directly from the Billing menu" },
      { term: "Refund Requirements", detail: "Only for technical issues on our side or duplicate payments, accompanied by verifiable proof" },
      { term: "Duplicate Charges", detail: "Full 100% refund if a duplicate deduction (double charge) occurs" },
      { term: "Disbursement Estimate", detail: "Verification in 2–3 business days; refund to the original account in 5–14 business days" },
    ],
    articles: [
      {
        id: "pembatalan",
        index: "01",
        title: "Invoice and Subscription Cancellation Policy",
        paragraphs: [
          "Customers have full control over every invoice and the continuation of their workspace subscription, with no binding long-term contract:",
        ],
        rows: [
          {
            term: "Pending Invoices",
            detail: "Unpaid invoices can be cancelled at any time via the Cancel button on the Billing page. The related Virtual Account or QRIS code is immediately deactivated in Midtrans.",
          },
          {
            term: "No Auto-Debit",
            detail: "We do not apply recurring automatic balance withdrawals. You are free to choose not to renew your plan at the end of the active period, without any penalty fee.",
          },
          {
            term: "Access for the Remaining Period",
            detail: "If you decide not to continue your subscription, all features of the plan you have paid for keep working normally until the plan's expiry date.",
          },
        ],
      },
      {
        id: "syarat-refund",
        index: "02",
        title: "Refund Eligibility Criteria",
        paragraphs: [
          "Refunds are only granted for technical issues that can be proven, namely one of the following conditions. Every request must include the Order ID and proof of payment, and is verified against Midtrans settlement data and our system records:",
        ],
        rows: [
          {
            term: "System Activation Failure",
            detail: "The payment has been verified as Paid (Settlement), but the plan quota failed to activate in the workspace for more than 24 hours due to an internal technical issue on our side.",
          },
          {
            term: "Duplicate Payment",
            detail: "A balance deduction occurred more than once (double charge) for the same invoice number or renewal period.",
          },
        ],
      },
      {
        id: "pengecualian",
        index: "03",
        title: "Non-Refundable Conditions",
        paragraphs: [
          "Refunds do not apply to the following conditions:",
        ],
        rows: [
          {
            term: "Change of Mind",
            detail: "Changing your mind, feeling that the results do not suit your taste, or not using the service during the plan's active period. A plan that has been activated normally cannot be refunded.",
          },
          {
            term: "No Verifiable Proof",
            detail: "Requests without an Order ID and proof of payment, or issues that are not recorded in Midtrans settlement data or in our system records.",
          },
          {
            term: "Violation of Terms",
            detail: "Suspension of workspace access caused by a violation of the Terms & Conditions or by account blocking by Meta.",
          },
        ],
      },
      {
        id: "prosedur-pengajuan",
        index: "04",
        title: "Request Procedure and Disbursement Time",
        paragraphs: [
          "Every refund request is processed through the following measurable stages:",
        ],
        rows: [
          {
            term: "Step 1 — Submission",
            detail: `Send your request to ${M.billingEmail} or WhatsApp ${M.whatsappDisplay}, including the Order ID, the email of the workspace owner's account, proof of payment, and proof of the issue (for example, a screenshot showing the plan status not yet active, or a bank statement showing a double deduction).`,
          },
          {
            term: "Step 2 — Verification",
            detail: "Our finance team matches the Midtrans settlement data and the workspace usage history within 2 to 3 business days.",
          },
          {
            term: "Step 3 — Disbursement",
            detail: "Approved funds are returned to the customer's original bank account or payment channel within 5 to 14 business days, in accordance with bank and Midtrans clearing procedures.",
          },
        ],
      },
    ],
  },

  pengiriman: {
    id: "pengiriman",
    order: "04",
    href: "/pengiriman-layanan",
    shortTitle: "Service Delivery",
    category: "DIGITAL PRODUCT ACTIVATION POLICY",
    title: "Service Delivery & Activation Policy",
    subtitle:
      "An explanation of the handover mechanism for cloud-based software products (SaaS), the automatic activation time standard, and payment status monitoring.",
    effectiveDate: M.effectiveDate,
    docCode: "BT-DOC/FD-04",
    jurisdiction: "Digital Product (SaaS) Handover Standard",
    summarySpecs: [
      { term: "Product Form", detail: "100% Cloud Software (SaaS) — no physical goods are shipped" },
      { term: "Delivery Fee", detail: "Rp 0 (no shipping fee; direct access through a web browser)" },
      { term: "Activation Time (SLA)", detail: "Automatic & instant (< 1 minute) after the payment status is Settlement" },
      { term: "Proof of Handover", detail: "Recorded directly in the billing history and the active-period status on the dashboard" },
    ],
    articles: [
      {
        id: "sifat-layanan",
        index: "01",
        title: "Nature of the Digital Product Without Physical Delivery",
        paragraphs: [
          "All subscription plans offered on the BotThreads platform are web-based software services (Software as a Service). No tangible physical goods are delivered by courier or shipping service.",
          "Service handover is deemed lawfully fulfilled at the moment the plan quota (Threads account limit, number of daily posts, and Automatic mode permission) has been activated in the customer's workspace.",
        ],
      },
      {
        id: "standar-waktu-aktivasi",
        index: "02",
        title: "Automatic Activation Time Standard (SLA)",
        paragraphs: [
          "The BotThreads billing system is integrated directly with the Midtrans Core API to activate plans automatically as soon as payment is received:",
        ],
        rows: [
          {
            term: "QRIS, GoPay & ShopeePay",
            detail: "The plan is activated instantly (on average in less than 10 seconds) after payment is confirmed in the e-wallet or m-banking app.",
          },
          {
            term: "Bank Virtual Account",
            detail: "The plan is activated automatically within 10 to 60 seconds after the transfer to the VA number (BCA, BNI, BRI, Mandiri, Permata, CIMB Niaga) has been successfully verified by the bank.",
          },
          {
            term: "Cumulative Renewal",
            detail: "If you renew your plan before the current active period ends, the new duration is added from the end date of the old plan, so your remaining active days are not forfeited.",
          },
        ],
      },
      {
        id: "sinkronisasi-dan-bantuan",
        index: "03",
        title: "Status Monitoring and Handling of Delays",
        paragraphs: [
          "In addition to real-time webhook notifications, the payment screen checks the transaction status automatically every 8 seconds, and the server scheduler synchronizes pending invoices every 5 minutes.",
          `If a banking network delay means the plan has not been activated within 15 minutes after the balance was deducted, the customer can press the 'I've paid' button on the Billing page or contact ${M.billingEmail} for immediate activation assistance.`,
        ],
      },
    ],
  },

  penghapusan: {
    id: "penghapusan",
    order: "05",
    href: "/penghapusan-data",
    shortTitle: "Data Deletion",
    category: "DATA DELETION PROCEDURE (UU PDP & META)",
    title: "Data Deletion Policy & Procedure",
    subtitle:
      "Official guidance for users to revoke Meta Threads account access tokens on their own, or to request the permanent deletion of all account and workspace data.",
    effectiveDate: M.effectiveDate,
    docCode: "BT-DOC/DD-05",
    jurisdiction: "UU PDP Article 43 (Personal Data Protection Law) & Meta Platform Policy",
    summarySpecs: [
      { term: "Revoke Threads Access", detail: "Can be done yourself at any time from the Settings > Threads Accounts menu" },
      { term: "Delete Content & Schedules", detail: "Can be deleted directly by the Owner/Admin from the Schedule & Knowledge pages" },
      { term: "Permanent Account Deletion", detail: "Processed within a maximum of 3 x 24 business hours through a verified email request" },
      { term: "Retention After Deletion", detail: "Tokens, drafts, and brand knowledge are permanently deleted from the active database" },
    ],
    articles: [
      {
        id: "pencabutan-mandiri",
        index: "01",
        title: "Revoking Threads Account Access Yourself",
        paragraphs: [
          "You have full control to end the connection between your Meta Threads account and the BotThreads dashboard at any time, without having to wait for our team's approval:",
        ],
        rows: [
          {
            term: "Through the BotThreads Dashboard",
            detail: "Open the Settings menu > Threads Accounts tab, select the account you want to disconnect, or switch Autopilot mode to Off. All queued schedules that have not yet been published can be cancelled immediately.",
          },
          {
            term: "Through Meta App Settings",
            detail: "Open the Threads or Instagram app > Settings > Security > Websites and App Permissions, then revoke the BotThreads app's access. The access token on our server will automatically become void.",
          },
        ],
      },
      {
        id: "penghapusan-permanen",
        index: "02",
        title: "Procedure for Requesting Permanent Deletion of the Account and Workspace",
        paragraphs: [
          "If you want to permanently delete your login account together with all workspace data (including encrypted tokens, the brand knowledge base, draft history, and team memberships) from our servers, follow these steps:",
        ],
        rows: [
          {
            term: "1. Send a Request",
            detail: `Send an email from the email address registered as the workspace Owner to ${M.supportEmail} with the subject: "Permohonan Penghapusan Data — [Nama Brand / Username]" (Data Deletion Request — [Brand Name / Username]).`,
          },
          {
            term: "2. Ownership Verification",
            detail: "Our team will verify that the request was sent by the lawful owner of the account, to prevent unauthorized deletion by other parties.",
          },
          {
            term: "3. Deletion Execution",
            detail: "Within a maximum of 3 x 24 business hours, all account data, access tokens, knowledge base, and schedules will be permanently deleted, and you will receive proof of the deletion confirmation by email.",
          },
        ],
      },
    ],
  },

  kontak: {
    id: "kontak",
    order: "06",
    href: "/kontak",
    shortTitle: "Contact & Identity",
    category: "OPERATOR INFORMATION & CUSTOMER SERVICE",
    title: "Official Contact & Operator Identity",
    subtitle:
      "Official information about the service operator, its operational address in Indonesia, technical support channels, and customer complaint services for transactions and billing.",
    effectiveDate: M.effectiveDate,
    docCode: "BT-DOC/MC-06",
    jurisdiction: "Indonesia (WIB / UTC+7)",
    summarySpecs: [
      { term: "Service Name", detail: M.brandName },
      { term: "Official Email", detail: M.supportEmail },
      { term: "Customer WhatsApp", detail: M.whatsappDisplay },
      { term: "Operating Hours", detail: M.operatingHours },
    ],
    articles: [
      {
        id: "saluran-bantuan",
        index: "01",
        title: "Official Communication Channels",
        paragraphs: [
          "We provide separate communication channels for different needs so that every technical question or payment administration matter can be handled quickly and accurately:",
        ],
        rows: [
          {
            term: "Technical & Account Support",
            detail: `Contact ${M.supportEmail} for help connecting Threads accounts, configuring autopilot, Google login issues, or data deletion requests.`,
          },
          {
            term: "Billing & Refund Service",
            detail: `Contact ${M.billingEmail} for questions about Midtrans payments (QRIS, E-Wallet, Virtual Account), billing receipts, or refund requests.`,
          },
          {
            term: "WhatsApp Quick Service",
            detail: `Contact ${M.whatsappDisplay} during business hours (${M.operatingHours}) for direct help from our operations team.`,
          },
        ],
      },
      {
        id: "mekanisme-pengaduan",
        index: "02",
        title: "Customer Complaint Handling Standard (SLA)",
        paragraphs: [
          "Every report of a transaction issue or service complaint is recorded and followed up according to the following response time standards:",
        ],
        rows: [
          {
            term: "Initial Response",
            detail: "A maximum of 2 business hours from when the message is received via WhatsApp or official email during operating hours.",
          },
          {
            term: "Payment Activation Issues",
            detail: "Resolved within 1 to 4 business hours after the proof of payment and Order ID have been verified against Midtrans records.",
          },
          {
            term: "Refund Request Resolution",
            detail: "A verification decision is issued within 2–3 business days, followed by a refund process of 5–14 business days.",
          },
        ],
      },
    ],
  },
};
