/**
 * One-off builder: extracts Termly ToS from agent transcript and writes legal.html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const transcriptPath =
  process.env.LEGAL_TOS_TRANSCRIPT ||
  path.join(
    process.env.USERPROFILE || "",
    ".cursor",
    "projects",
    "c-Users-Colli-OneDrive-Documents-TTRPG-SoundBoard-main",
    "agent-transcripts",
    "6a3b4248-2ca9-4ddf-bb27-d11c7b644278",
    "6a3b4248-2ca9-4ddf-bb27-d11c7b644278.jsonl"
  );

function extractTosFromTranscript(raw) {
  const marker = "2. Paste the Terms of Service text here:";
  const marker3 = "3. Paste the Privacy Policy text here:";
  const i = raw.indexOf(marker);
  if (i < 0) throw new Error("ToS marker not found in transcript");
  const start = raw.indexOf("<style>", i);
  const end = raw.indexOf(marker3, start);
  if (start < 0 || end < 0) throw new Error("ToS HTML bounds not found");
  let html = raw.slice(start, end).trim();
  if (html.length < 100) {
    throw new Error(`ToS slice too short: ${html.length} (start=${start}, end=${end})`);
  }
  // Termly export wraps content in a single <style> block then body divs
  const styleEnd = html.indexOf("</style>");
  if (styleEnd >= 0) {
    html = html.slice(styleEnd + "</style>".length).trim();
  } else {
    html = html.replace(/<style>[\s\S]*?<\/style>/gi, "");
  }
  html = html.replace(
    /<span style="display: block;margin: 0 auto[\s\S]*?<\/span>\s*/i,
    ""
  );
  html = html.replace(/<bdt[^>]*>/gi, "").replace(/<\/bdt>/gi, "");
  html = html.replace(
    /<br><div><span[^>]*>This Terms and Conditions[\s\S]*?<\/div>\s*$/i,
    ""
  );
  html = html.replace(/\sstyle="[^"]*"/gi, "");
  html = html.replace(/class="MsoNormal"/gi, 'class="legal-para"');
  html = html.replace(/\salign="center"/gi, "");
  const out = html.trim();
  if (out.length < 100) {
    throw new Error(`ToS cleaned too short: ${out.length} (raw slice was ${raw.slice(start, end).trim().length})`);
  }
  return out;
}

const privacyHtml = `
<section id="privacy" class="legal-section">
  <h1>Privacy Policy</h1>
  <p class="legal-meta"><strong>Last updated:</strong> May 2026</p>

  <h2>1. Introduction</h2>
  <p>Grendil Studios LLC ("we," "us," or "our") operates Skald, a web-based audio toolkit for tabletop roleplaying game masters, accessible at <a href="https://www.skaldsoundboard.com">www.skaldsoundboard.com</a> ("the Service"). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service. Please read this policy carefully. If you disagree with its terms, please discontinue use of the Service.</p>

  <h2>2. Information We Collect</h2>
  <p><strong>Information you provide directly:</strong></p>
  <ul>
    <li>Email address — when you create an account</li>
    <li>Password — encrypted and never stored in plain text</li>
    <li>Scene and session data — the audio scenes and sessions you create within the Service</li>
    <li>Audio files — music tracks, sound effects, and ambient sounds you upload as a paid subscriber</li>
    <li>Feedback and support messages — when you contact us or submit feedback through the app</li>
  </ul>
  <p><strong>Information collected automatically:</strong></p>
  <ul>
    <li>Usage data — how you interact with the Service, which features you use, and session duration</li>
    <li>Device information — browser type, operating system, and device type</li>
    <li>IP address — collected by our hosting provider for security and performance purposes</li>
    <li>Cookies and local storage — see Section 8 for full details</li>
  </ul>

  <h2>3. How We Use Your Information</h2>
  <p>We use the information we collect to:</p>
  <ul>
    <li>Provide, operate, and maintain the Service</li>
    <li>Create and manage your account</li>
    <li>Process payments and manage your subscription</li>
    <li>Send transactional emails such as account confirmations, password resets, and billing receipts</li>
    <li>Respond to your questions and support requests</li>
    <li>Improve and develop the Service based on how it is used</li>
    <li>Enforce our Terms of Service and protect against misuse</li>
    <li>Comply with legal obligations</li>
  </ul>
  <p>We do not sell your personal information to third parties. We do not use your information for advertising purposes.</p>

  <h2>4. How We Share Your Information</h2>
  <p>We share your information only with the following third party service providers who help us operate the Service. Each provider is bound by their own privacy policy and data processing agreements:</p>
  <ul>
    <li><strong>Supabase</strong> — provides our database, file storage, and authentication services. Your account data, scenes, sessions, and uploaded files are stored on Supabase infrastructure. Privacy policy: <a href="https://supabase.com/privacy" rel="noopener noreferrer" target="_blank">https://supabase.com/privacy</a></li>
    <li><strong>Stripe</strong> — processes subscription payments on our behalf. When you subscribe to Skald Pro, Stripe collects and processes your payment information. We never store your full card details. Privacy policy: <a href="https://stripe.com/privacy" rel="noopener noreferrer" target="_blank">https://stripe.com/privacy</a></li>
    <li><strong>Vercel</strong> — hosts and serves the Skald web application. Vercel may process your IP address and usage data as part of delivering the Service. Privacy policy: <a href="https://vercel.com/legal/privacy-policy" rel="noopener noreferrer" target="_blank">https://vercel.com/legal/privacy-policy</a></li>
  </ul>
  <p>We may also disclose your information if required by law, court order, or government authority, or to protect the rights, property, or safety of Grendil Studios LLC, our users, or others.</p>

  <h2>5. Data Retention</h2>
  <p>We retain your personal information for as long as your account is active. If you delete your account we will permanently delete your personal data within 30 days, except where we are required to retain it for legal or financial compliance purposes such as billing records which may be retained for up to 7 years as required by tax law.</p>
  <p>Uploaded audio files are deleted from our storage systems within 30 days of account deletion.</p>

  <h2>6. International Data Transfers</h2>
  <p>Grendil Studios LLC is based in the United States. If you are accessing the Service from the European Union, United Kingdom, or other regions with data protection laws that differ from US law, please be aware that your information will be transferred to and processed in the United States.</p>
  <p>We rely on Standard Contractual Clauses approved by the European Commission as the legal mechanism for transferring personal data from the EU and UK to the United States. Our third party processors — Supabase, Stripe, and Vercel — all maintain Standard Contractual Clauses as part of their data processing agreements.</p>

  <h2>7. Your Privacy Rights</h2>
  <p>Depending on your location you may have the following rights regarding your personal information:</p>
  <p><strong>All users:</strong></p>
  <ul>
    <li>Right to access — you may request a copy of the personal information we hold about you</li>
    <li>Right to correction — you may request that we correct inaccurate information</li>
    <li>Right to deletion — you may delete your account and all associated data at any time through the account settings in the app</li>
    <li>Right to data portability — you may export your scene and session data at any time</li>
  </ul>
  <p><strong>EU and UK users (GDPR):</strong> All of the above rights apply. Our legal basis for processing your personal data is performance of a contract — we process your data to provide the Service you signed up for. You may also lodge a complaint with your local data protection authority.</p>
  <p><strong>California users (CCPA):</strong> You have the right to know what personal information we collect and how it is used, the right to delete your personal information, the right to opt out of the sale of your personal information (we do not sell your information), and the right to non-discrimination for exercising your privacy rights.</p>
  <p>To exercise any of these rights contact us at <a href="mailto:legal@skaldsoundboard.com">legal@skaldsoundboard.com</a>. We will respond within 30 days.</p>

  <h2>8. Cookie Policy</h2>
  <p><strong>What are cookies:</strong> Cookies are small text files stored on your device by your browser. We also use browser localStorage, which functions similarly to cookies for storing preferences on your device.</p>
  <p><strong>What we use:</strong></p>
  <p><strong>Strictly necessary</strong> — authentication cookies Supabase sets a session cookie to keep you logged in to your account. Without this cookie you would need to sign in every time you visit. These cookies are essential for the Service to function and do not require your consent.</p>
  <p><strong>Functional</strong> — preference storage We use browser localStorage to remember your preferences such as your active scene, volume settings, whether you have completed the onboarding tour, and your anonymous scenes if you have not created an account. This data stays on your device and is not transmitted to our servers.</p>
  <p><strong>What we do not use:</strong> We do not use advertising cookies, analytics tracking cookies, or any third party tracking pixels. We do not serve ads.</p>
  <p><strong>Managing cookies:</strong> You can clear cookies and localStorage at any time through your browser settings. Note that clearing authentication cookies will sign you out of your account and clearing localStorage will remove your saved anonymous scenes and preferences.</p>

  <h2>9. Children's Privacy</h2>
  <p>The Service is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected information from a child under 13 please contact us at <a href="mailto:legal@skaldsoundboard.com">legal@skaldsoundboard.com</a> and we will delete it promptly.</p>

  <h2>10. Security</h2>
  <p>We implement industry-standard security measures to protect your personal information including encrypted data transmission via HTTPS, encrypted password storage, and row-level security on our database ensuring users can only access their own data. However no method of transmission over the internet is 100% secure and we cannot guarantee absolute security.</p>
  <p>In the event of a data breach that affects your personal information we will notify you within 72 hours of becoming aware of the breach as required by applicable law.</p>

  <h2>11. Third Party Links</h2>
  <p>The Service may contain links to third party websites. We are not responsible for the privacy practices of those websites and encourage you to review their privacy policies.</p>

  <h2>12. Changes to This Policy</h2>
  <p>We may update this Privacy Policy from time to time. We will notify you of significant changes by email to the address associated with your account and by posting the updated policy on this page with a new effective date. Your continued use of the Service after changes are posted constitutes your acceptance of the updated policy.</p>

  <h2>13. Contact Us</h2>
  <p>If you have questions about this Privacy Policy or wish to exercise your privacy rights please contact us:</p>
  <p>
    Grendil Studios LLC<br />
    Attn: Privacy<br />
    PO Box 1078<br />
    Windermere, FL 34786<br />
    United States<br />
    Email: <a href="mailto:legal@skaldsoundboard.com">legal@skaldsoundboard.com</a>
  </p>
</section>
`;

const shell = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Legal — Skald Sound Board</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <style>
    :root {
      --bg: #0f0f12;
      --panel: #18181d;
      --text: #f2f2f5;
      --muted: #9b9ba8;
      --accent: #7f77dd;
      --border: rgba(255, 255, 255, 0.08);
      --font-ui: system-ui, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-ui);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      font-size: 15px;
    }
    .legal-wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 20px 64px;
    }
    .legal-back {
      display: inline-block;
      margin-bottom: 28px;
      color: var(--accent);
      text-decoration: none;
      font-size: 14px;
    }
    .legal-back:hover { text-decoration: underline; }
    .legal-section {
      margin-bottom: 48px;
      padding-bottom: 40px;
      border-bottom: 1px solid var(--border);
    }
    .legal-section:last-child { border-bottom: none; }
    .legal-section h1 {
      font-size: 1.75rem;
      font-weight: 600;
      margin: 0 0 8px;
      color: var(--text);
    }
    .legal-meta { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
    .legal-section h2 {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 28px 0 12px;
      color: var(--text);
    }
    .legal-section h3 {
      font-size: 1rem;
      font-weight: 600;
      margin: 20px 0 10px;
    }
    .legal-section p, .legal-para { margin: 0 0 14px; color: #c8c8d4; }
    .legal-section ul { margin: 0 0 14px; padding-left: 1.35rem; color: #c8c8d4; }
    .legal-section li { margin-bottom: 6px; }
    .legal-section a { color: var(--accent); }
    .legal-section a:hover { text-decoration: underline; }
    .legal-tos-body strong { color: var(--text); font-weight: 600; }
    .legal-tos-body h1, .legal-tos-body h2, .legal-tos-body h3 {
      color: var(--text);
      font-weight: 600;
    }
    .legal-tos-body h1 { font-size: 1.75rem; margin: 0 0 8px; }
    .legal-tos-body h2 { font-size: 1.125rem; margin: 28px 0 12px; }
    .legal-tos-body h3 { font-size: 1rem; margin: 20px 0 10px; }
  </style>
</head>
<body>
  <div class="legal-wrap">
    <a class="legal-back" href="/">← Back to app</a>

    <section id="terms" class="legal-section">
      <div class="legal-tos-body">
        __TOS_BODY__
      </div>
    </section>

    __PRIVACY__
  </div>
</body>
</html>
`;

let tosBody = "";
if (fs.existsSync(transcriptPath)) {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line.includes("Paste the Terms of Service")) continue;
    try {
      const obj = JSON.parse(line);
      const text = obj?.message?.content?.[0]?.text || "";
      tosBody = extractTosFromTranscript(text);
      if (tosBody.length < 1000) {
        console.warn("ToS extract short:", tosBody.length);
        tosBody = "";
      }
      break;
    } catch (err) {
      console.error("ToS line parse/extract:", err.message);
    }
  }
}

if (!tosBody && fs.existsSync(path.join(root, "legal-tos-raw.html"))) {
  tosBody = extractTosFromTranscript(fs.readFileSync(path.join(root, "legal-tos-raw.html"), "utf8"));
}

if (!tosBody) {
  console.error("Could not extract ToS HTML. Set LEGAL_TOS_TRANSCRIPT or add legal-tos-raw.html");
  process.exit(1);
}

const out = shell.replace("__TOS_BODY__", tosBody).replace("__PRIVACY__", privacyHtml.trim());
fs.writeFileSync(path.join(root, "legal.html"), out, "utf8");
console.log("Wrote legal.html (" + out.length + " bytes)");
