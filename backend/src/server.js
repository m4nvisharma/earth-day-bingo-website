import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import multer from "multer";
import { randomUUID, randomBytes, createHash } from "crypto";
import { query, ensureSchema, ensureItems } from "./db.js";
import { authMiddleware, signToken } from "./auth.js";
import { storeImage } from "./storage.js";
import { canSendEmail, configureEmail, sendEmail } from "./email.js";

const app = express();

const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 2) * 1024 * 1024;
const upload = multer({
  limits: { fileSize: maxUploadBytes },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("INVALID_FILE_TYPE"));
    }
    return cb(null, true);
  }
});

const corsOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes("*") || corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

const uploadDir = (process.env.UPLOAD_DIR || "uploads").replace(/^\/+/, "");
app.use(`/${uploadDir}`, express.static(uploadDir));

const adminEmail = (process.env.ADMIN_EMAIL || "info@cycat.ca").toLowerCase();
const publicBackendUrl = (process.env.PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
const publicFrontendUrl = (process.env.PUBLIC_FRONTEND_URL || "").replace(/\/$/, "");

function isAdminRequester(req) {
  const requesterEmail = (req.user?.email || "").toLowerCase();
  return requesterEmail === adminEmail;
}

function parseEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const hasSupabaseStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const hasS3Storage = Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
const storageLimitMb = parseEnvNumber(process.env.STORAGE_LIMIT_MB, 1024);
const storageWarnPercent = parseEnvNumber(process.env.STORAGE_WARN_PERCENT, 85);
const storageCriticalPercent = parseEnvNumber(process.env.STORAGE_CRITICAL_PERCENT, 95);
const storageAlertCooldownHours = parseEnvNumber(process.env.STORAGE_ALERT_COOLDOWN_HOURS, 24);
const storageAlertCooldownMs = storageAlertCooldownHours * 60 * 60 * 1000;
let lastStorageAlertAt = 0;
let lastStorageAlertLevel = "ok";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / mb))} MB`;
}

async function getDirectorySize(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await fs.promises.stat(fullPath);
    total += stats.size || 0;
  }
  return total;
}

function getStorageLevel(usagePercent) {
  if (!Number.isFinite(usagePercent)) return "unknown";
  if (usagePercent >= storageCriticalPercent) return "critical";
  if (usagePercent >= storageWarnPercent) return "warning";
  return "ok";
}

async function getStorageSummary() {
  if (hasSupabaseStorage || hasS3Storage) {
    return {
      source: "external",
      usageBytes: null,
      limitBytes: null,
      usagePercent: null,
      status: "external",
      warnPercent: storageWarnPercent,
      criticalPercent: storageCriticalPercent
    };
  }

  const limitBytes = storageLimitMb > 0 ? storageLimitMb * 1024 * 1024 : null;
  const fullDir = path.join(process.cwd(), uploadDir);
  try {
    const usageBytes = await getDirectorySize(fullDir);
    const usagePercent = limitBytes ? Math.round((usageBytes / limitBytes) * 10) / 10 : null;
    return {
      source: "local",
      usageBytes,
      limitBytes,
      usagePercent,
      status: getStorageLevel(usagePercent),
      warnPercent: storageWarnPercent,
      criticalPercent: storageCriticalPercent
    };
  } catch (error) {
    console.warn("Storage size check failed", error);
    return {
      source: "local",
      usageBytes: null,
      limitBytes,
      usagePercent: null,
      status: "unknown",
      warnPercent: storageWarnPercent,
      criticalPercent: storageCriticalPercent
    };
  }
}

async function trySendStorageWarning(summary, reason) {
  if (summary.source !== "local") return;
  if (!summary.limitBytes || !Number.isFinite(summary.usagePercent)) return;
  if (summary.status === "ok" || summary.status === "unknown") {
    lastStorageAlertLevel = "ok";
    return;
  }

  const now = Date.now();
  const shouldSend =
    summary.status !== lastStorageAlertLevel ||
    (storageAlertCooldownMs > 0 && now - lastStorageAlertAt >= storageAlertCooldownMs);
  if (!shouldSend) return;

  if (!canSendEmail()) {
    console.warn("Storage warning skipped: SendGrid not configured");
    return;
  }

  const percentText = `${summary.usagePercent.toFixed(1)}%`;
  const usageText = formatBytes(summary.usageBytes);
  const limitText = formatBytes(summary.limitBytes);
  const levelLabel = summary.status === "critical" ? "critical" : "warning";
  const subject = `Storage ${levelLabel}: ${percentText} of ${limitText} used`;
  const html = `
    <div style="font-family:Arial, sans-serif;color:#1b1b1b">
      <h2 style="color:#1f3f2b">Storage ${levelLabel}</h2>
      <p>Usage is at <strong>${percentText}</strong> (${usageText} of ${limitText}).</p>
      <p>Reason: ${reason || "periodic check"}.</p>
    </div>
  `;
  const text = `Storage ${levelLabel}: ${percentText} (${usageText} of ${limitText}). Reason: ${reason || "periodic check"}.`;

  try {
    await sendEmail({ to: adminEmail, subject, html, text });
    lastStorageAlertAt = now;
    lastStorageAlertLevel = summary.status;
  } catch (error) {
    const detail = error?.response?.body?.errors
      ? JSON.stringify(error.response.body.errors)
      : error.message || error;
    console.warn("Storage warning email failed", detail);
  }
}

const fallbackBingoLabels = [
  "Pick up and collect at least 15 pieces of litter",
  "Sort a day's waste into recycling, compost, and garbage correctly",
  "Walk or bike for at least 15 minutes instead of driving",
  "Create something useful using only recycled materials",
  "Use reusable bags during a shopping trip",
  "Donate a bag of at least 3 clothing items",
  "Air-dry clothes instead of using a dryer",
  "Eat plant-based for a day",
  "Collect and recycle at least 10 plastic bottles or cans",
  "Clean and reuse at least 3 containers",
  "Spend 30 minutes removing weeds or caring for plants/garden",
  "Turn off heating/AC",
  "Spend 30 minutes outdoors appreciating nature",
  "Change your search engine to Ecosia",
  "Use public transit for at least three trips",
  "Do an environmental action (not listed) of your choice",
  "Reorganize and reduce items in your room",
  "Donate 3 items",
  "Fix or repair one broken item instead of throwing it away",
  "Reduce screentime to 1 hr less than your average screentime",
  "Properly dispose of at least 2 pieces of hazardous waste",
  "Write a letter or phone a politician to advocate for environmental action",
  "Borrow something instead of buying it",
  "Use stairs instead of elevators or escalators",
  "Thrift clothes"
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bingoFilePath = path.resolve(__dirname, "../../prompts/bingo_cards.txt");
const MAX_DAILY_ACTIONS = Number(process.env.MAX_DAILY_ACTIONS || 4);

function validateUsername(raw) {
  const username = String(raw || "").trim();
  if (!/^[a-zA-Z0-9]{4,}$/.test(username)) {
    return { ok: false, reason: "Username must be at least 4 characters and contain only letters and numbers." };
  }
  return { ok: true, username };
}

function cleanText(value, maxLength = 200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

async function getCycatReferralBonusForUser(userId) {
  const { rows: userRows } = await query("SELECT email FROM users WHERE id = $1", [userId]);
  if (userRows.length === 0) return 0;

  const normalizedEmail = normalizeEmail(userRows[0].email);
  if (!normalizedEmail) return 0;

  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM user_surveys
      WHERE discovery_source = 'cycat'
        AND completed_at IS NOT NULL
        AND skipped_at IS NULL
        AND user_id <> $2
        AND LOWER(TRIM(cycat_referral_email)) = $1`,
    [normalizedEmail, userId]
  );

  return rows[0]?.count || 0;
}

const surveySourceOptions = new Set([
  "instagram",
  "linkedin",
  "tiktok",
  "website",
  "podcast",
  "friend",
  "cycat",
  "other",
  "prefer-not-to-say"
]);

function normalizeSurveySource(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return surveySourceOptions.has(raw) ? raw : null;
}

function normalizeLabel(label) {
  return label
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-");
}

function loadBingoLabels() {
  try {
    if (!fs.existsSync(bingoFilePath)) return fallbackBingoLabels;
    const content = fs.readFileSync(bingoFilePath, "utf8");
    const labels = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeLabel(line));
    return labels.length > 0 ? labels : fallbackBingoLabels;
  } catch (error) {
    console.warn("Unable to read bingo_cards.txt; using fallback labels.");
    return fallbackBingoLabels;
  }
}

function countCompletedLines(checked, size = 5) {
  if (checked.length < size * size) return 0;
  const lines = [];
  for (let r = 0; r < size; r++) {
    lines.push(checked.slice(r * size, r * size + size));
  }
  for (let c = 0; c < size; c++) {
    lines.push(Array.from({ length: size }, (_, r) => checked[r * size + c]));
  }
  lines.push(Array.from({ length: size }, (_, i) => checked[i * size + i]));
  lines.push(Array.from({ length: size }, (_, i) => checked[i * size + (size - i - 1)]));
  return lines.filter((line) => line.every(Boolean)).length;
}

function getCompletedLines(checked, size = 5) {
  if (checked.length < size * size) return [];
  const lines = [];
  for (let r = 0; r < size; r++) {
    lines.push({ key: `row-${r + 1}`, label: `Row ${r + 1}`, indexes: checked.slice(r * size, r * size + size) });
  }
  for (let c = 0; c < size; c++) {
    lines.push({
      key: `col-${c + 1}`,
      label: `Column ${c + 1}`,
      indexes: Array.from({ length: size }, (_, r) => checked[r * size + c])
    });
  }
  lines.push({
    key: "diag-main",
    label: "Diagonal (top-left to bottom-right)",
    indexes: Array.from({ length: size }, (_, i) => checked[i * size + i])
  });
  lines.push({
    key: "diag-anti",
    label: "Diagonal (top-right to bottom-left)",
    indexes: Array.from({ length: size }, (_, i) => checked[i * size + (size - i - 1)])
  });
  return lines.filter((line) => line.indexes.every(Boolean));
}

function resolveImageUrl(imageUrl) {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("http")) return imageUrl;
  if (!publicBackendUrl) return imageUrl;
  return `${publicBackendUrl}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

function buildBingoCardHtml(items, statusMap) {
  const cards = items.map((item) => {
    const row = statusMap.get(item.id);
    const checked = row?.checked ? "Yes" : "No";
    const imageUrl = resolveImageUrl(row?.image_url || "");
    const imageHtml = imageUrl
      ? `<div style="margin-top:8px"><img src="${imageUrl}" alt="Photo" style="max-width:120px;border-radius:10px;border:1px solid #dfe7dc" /></div>`
      : "";
    return `
      <div style="border:1px solid #e3e9de;border-radius:12px;padding:10px;background:#ffffff">
        <div style="font-weight:600;color:#1f3f2b">${item.label}</div>
        <div style="font-size:12px;color:#6e8f7b;margin-top:4px">Completed: ${checked}</div>
        ${imageHtml}
      </div>
    `;
  });

  return `
    <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px">
      ${cards.join("")}
    </div>
  `;
}

async function sendLineCompletionEmail({ user, line, items, statusMap }) {
  if (!canSendEmail()) return;
  const cardHtml = buildBingoCardHtml(items, statusMap);
  const subject = `Earth Day Bingo: ${user.display_name} completed ${line.label}`;
  const html = `
    <div style="font-family:Arial, sans-serif;color:#1b1b1b">
      <h2 style="color:#1f3f2b">Line completed!</h2>
      <p><strong>${user.display_name}</strong> (${user.email}) completed <strong>${line.label}</strong>.</p>
      <h3 style="margin-top:24px;color:#1f3f2b">Bingo card + photos</h3>
      ${cardHtml}
    </div>
  `;
  const text = `${user.display_name} (${user.email}) completed ${line.label}.`;

  await sendEmail({
    to: adminEmail,
    subject,
    html,
    text
  });
}

async function trySendLineCompletionEmail(payload) {
  try {
    if (!canSendEmail()) {
      console.warn("Line completion email skipped: SendGrid not configured");
      return;
    }
    await sendLineCompletionEmail(payload);
  } catch (error) {
    const detail = error?.response?.body?.errors
      ? JSON.stringify(error.response.body.errors)
      : error.message || error;
    console.warn("Line completion email failed", detail);
  }
}

async function recordLineCompletions(userId, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  for (const line of lines) {
    await query(
      `INSERT INTO line_completions (user_id, line_key, line_label)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, line_key) DO NOTHING`,
      [userId, line.key, line.label]
    );
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/auth/signup", async (req, res) => {
  const { email, password, displayName, username } = req.body || {};
  if (!email || !password || !username) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const usernameCheck = validateUsername(username);
  if (!usernameCheck.ok) {
    return res.status(400).json({ error: usernameCheck.reason });
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const usernameExisting = await query("SELECT id FROM users WHERE username = $1", [usernameCheck.username]);
  if (usernameExisting.rowCount > 0) {
    return res.status(409).json({ error: "Username already in use" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = randomUUID();
  const displayCandidate = (displayName || "").trim();
  const safeDisplayName = displayCandidate || usernameCheck.username;
  await query(
    "INSERT INTO users (id, email, password_hash, display_name, username) VALUES ($1, $2, $3, $4, $5)",
    [userId, email, passwordHash, safeDisplayName, usernameCheck.username]
  );

  const token = signToken({ sub: userId, email });
  return res.json({ token, user: { id: userId, email, displayName: safeDisplayName, username: usernameCheck.username } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const { rows } = await query("SELECT id, password_hash, display_name, username FROM users WHERE email = $1", [email]);
  if (rows.length === 0) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken({ sub: user.id, email });
  return res.json({ token, user: { id: user.id, email, displayName: user.display_name, username: user.username } });
});

app.get("/api/user/me", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await query(
    `SELECT id, email, display_name, username, consent_photo_use, consent_authentic, consent_at, theme_preference, certificate_earned_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: "User not found" });
  const user = rows[0];
  return res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    username: user.username,
    consentPhotoUse: user.consent_photo_use,
    consentAuthentic: user.consent_authentic,
    consentAt: user.consent_at,
    themePreference: user.theme_preference,
    certificateEarnedAt: user.certificate_earned_at
  });
});

app.get("/api/user/profile", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await query(
    `SELECT username, display_name, avatar_base, avatar_props, theme_preference
     FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: "User not found" });
  const user = rows[0];
  return res.json({
    username: user.username,
    displayName: user.display_name,
    avatarBase: user.avatar_base,
    avatarProps: user.avatar_props || [],
    themePreference: user.theme_preference || "light"
  });
});

app.put("/api/user/profile", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { avatarBase, avatarProps, themePreference } = req.body || {};
  const props = Array.isArray(avatarProps) ? avatarProps.slice(0, 1) : [];
  const theme = themePreference === "dark" ? "dark" : "light";

  await query(
    `UPDATE users
     SET avatar_base = $1,
         avatar_props = $2,
         theme_preference = $3
     WHERE id = $4`,
    [avatarBase || null, props, theme, userId]
  );

  return res.json({ ok: true });
});

app.delete("/api/user", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  await query("DELETE FROM users WHERE id = $1", [userId]);
  return res.json({ ok: true });
});

app.put("/api/user/consent", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { consentPhotoUse, consentAuthentic } = req.body || {};
  if (consentPhotoUse !== true || consentAuthentic !== true) {
    return res.status(400).json({ error: "Consent must be accepted" });
  }

  await query(
    `UPDATE users
     SET consent_photo_use = TRUE,
         consent_authentic = TRUE,
         consent_at = NOW()
     WHERE id = $1`,
    [userId]
  );

  return res.json({ ok: true });
});

app.get("/api/user/survey", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const referralBonus = await getCycatReferralBonusForUser(userId);
  const { rows } = await query(
    `SELECT is_under_30, age_range, race, disability, sexual_orientation, rural, location, discovery_source,
            friend_referral_email, cycat_referral_email, other_discovery,
            completed_at, skipped_at
       FROM user_surveys WHERE user_id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    return res.json({
      isUnder30: null,
      ageRange: null,
      race: null,
      disability: null,
      sexualOrientation: null,
      rural: null,
      location: null,
      discoverySource: null,
      friendReferralEmail: null,
      cycatReferralEmail: null,
      otherDiscovery: null,
      completedAt: null,
      skippedAt: null,
      referralBonus
    });
  }

  const survey = rows[0];

  return res.json({
    isUnder30: survey.is_under_30,
    ageRange: survey.age_range,
    race: survey.race,
    disability: survey.disability,
    sexualOrientation: survey.sexual_orientation,
    rural: survey.rural,
    location: survey.location,
    discoverySource: survey.discovery_source,
    friendReferralEmail: survey.friend_referral_email,
    cycatReferralEmail: survey.cycat_referral_email,
    otherDiscovery: survey.other_discovery,
    completedAt: survey.completed_at,
    skippedAt: survey.skipped_at,
    referralBonus
  });
});

app.put("/api/user/survey", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const payload = req.body || {};
  const discoverySource = normalizeSurveySource(payload.discoverySource);
  const isUnder30 = typeof payload.isUnder30 === "boolean" ? payload.isUnder30 : null;

  if (isUnder30 === null) {
    return res.status(400).json({ error: "Please indicate whether you are aged 30 or below." });
  }

  const ageRange = cleanText(payload.ageRange, 80);
  const race = cleanText(payload.race, 140);
  const disability = cleanText(payload.disability, 140);
  const sexualOrientation = cleanText(payload.sexualOrientation, 140);
  const rural = cleanText(payload.rural, 80);
  const location = cleanText(payload.location, 140);
  let friendReferralEmail = cleanText(payload.friendReferralEmail, 140);
  let cycatReferralEmail = cleanText(payload.cycatReferralEmail, 140);
  const otherDiscovery = cleanText(payload.otherDiscovery, 140);

  if (discoverySource !== "friend") {
    friendReferralEmail = null;
  }
  if (discoverySource !== "cycat") {
    cycatReferralEmail = null;
  }

  if (discoverySource === "friend" && !friendReferralEmail) {
    return res.status(400).json({ error: "Friend referral email is required." });
  }
  if (discoverySource === "cycat" && !cycatReferralEmail) {
    return res.status(400).json({ error: "CYCAT referral email is required." });
  }

  const otherDetail = discoverySource === "other" ? otherDiscovery : null;

  await query(
    `INSERT INTO user_surveys (
       user_id, is_under_30, age_range, race, disability, sexual_orientation, rural, location, discovery_source,
       friend_referral_email, cycat_referral_email, other_discovery, completed_at, updated_at, skipped_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       is_under_30 = EXCLUDED.is_under_30,
       age_range = EXCLUDED.age_range,
       race = EXCLUDED.race,
       disability = EXCLUDED.disability,
       sexual_orientation = EXCLUDED.sexual_orientation,
       rural = EXCLUDED.rural,
       location = EXCLUDED.location,
       discovery_source = EXCLUDED.discovery_source,
       friend_referral_email = EXCLUDED.friend_referral_email,
       cycat_referral_email = EXCLUDED.cycat_referral_email,
       other_discovery = EXCLUDED.other_discovery,
       completed_at = NOW(),
       skipped_at = NULL,
       updated_at = NOW()`,
    [
      userId,
      isUnder30,
      ageRange,
      race,
      disability,
      sexualOrientation,
      rural,
      location,
      discoverySource,
      friendReferralEmail,
      cycatReferralEmail,
      otherDetail
    ]
  );

  return res.json({ ok: true });
});

app.post("/api/user/survey/skip", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  await query(
    `INSERT INTO user_surveys (user_id, completed_at, skipped_at, updated_at)
     VALUES ($1, NOW(), NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       skipped_at = NOW(),
       completed_at = COALESCE(user_surveys.completed_at, NOW()),
       updated_at = NOW()`,
    [userId]
  );

  return res.json({ ok: true });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Missing email" });

  const { rows } = await query("SELECT id, email, display_name FROM users WHERE email = $1", [email]);
  if (rows.length === 0) {
    return res.json({ ok: true });
  }

  const user = rows[0];
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const resetId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  await query(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)` ,
    [resetId, user.id, tokenHash, expiresAt]
  );

  if (!canSendEmail()) {
    return res.status(500).json({ error: "Email is not configured" });
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin.replace(/\/$/, "") : "";
  const frontendBase = publicFrontendUrl || origin;
  if (!frontendBase) {
    return res.status(500).json({ error: "Missing PUBLIC_FRONTEND_URL" });
  }

  const resetLink = `${frontendBase}/reset.html?token=${rawToken}`;
  const html = `
    <div style="font-family:Arial, sans-serif;color:#1b1b1b">
      <h2 style="color:#1f3f2b">Reset your password</h2>
      <p>Hi ${user.display_name},</p>
      <p>Use the link below to reset your password. This link expires in 30 minutes.</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
    </div>
  `;
  await sendEmail({
    to: user.email,
    subject: "Reset your Earth Day Bingo password",
    html,
    text: `Reset your password: ${resetLink}`
  });

  return res.json({ ok: true });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: "Missing token or password" });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await query(
    `SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1`,
    [tokenHash]
  );
  if (rows.length === 0) return res.status(400).json({ error: "Invalid token" });

  const reset = rows[0];
  if (reset.used_at) return res.status(400).json({ error: "Token already used" });
  if (new Date(reset.expires_at) < new Date()) {
    return res.status(400).json({ error: "Token expired" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, reset.user_id]);
  await query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [reset.id]);

  return res.json({ ok: true });
});

app.get("/api/bingo/items", authMiddleware, async (req, res) => {
  const { rows } = await query("SELECT id, label FROM bingo_items ORDER BY id ASC");
  return res.json({ items: rows });
});

app.get("/api/bingo/state", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await query(
    "SELECT item_id, checked, image_url FROM user_item_status WHERE user_id = $1",
    [userId]
  );
  return res.json({ state: rows });
});

app.put("/api/bingo/state", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { itemId, checked } = req.body || {};
  if (!itemId || typeof checked !== "boolean") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (checked === true) {
    const { rows: imageRows } = await query(
      "SELECT image_url FROM user_item_status WHERE user_id = $1 AND item_id = $2",
      [userId, itemId]
    );
    const imageUrl = imageRows[0]?.image_url;
    if (!imageUrl) {
      return res.status(400).json({ error: "Photo required before completion" });
    }
  }

  const { rows: itemRows } = await query("SELECT id, label FROM bingo_items ORDER BY id ASC");
  const { rows: currentRows } = await query(
    "SELECT item_id, checked, image_url FROM user_item_status WHERE user_id = $1",
    [userId]
  );
  const statusMap = new Map(currentRows.map((row) => [row.item_id, row]));
  const beforeChecked = itemRows.map((item) => Boolean(statusMap.get(item.id)?.checked));

  await query(
    `INSERT INTO user_item_status (user_id, item_id, checked)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, item_id)
     DO UPDATE SET checked = EXCLUDED.checked, updated_at = NOW()` ,
    [userId, itemId, checked]
  );

  const nextStatusMap = new Map(statusMap);
  nextStatusMap.set(itemId, {
    ...(nextStatusMap.get(itemId) || { item_id: itemId }),
    checked,
    image_url: nextStatusMap.get(itemId)?.image_url || null
  });
  const afterChecked = itemRows.map((item) => Boolean(nextStatusMap.get(item.id)?.checked));

  const beforeLines = getCompletedLines(beforeChecked);
  const afterLines = getCompletedLines(afterChecked);
  const newLines = afterLines.filter((line) => !beforeLines.some((prev) => prev.key === line.key));

  if (newLines.length > 0) {
    await recordLineCompletions(userId, newLines);
    const { rows: userRows } = await query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]);
    const user = userRows[0];
    for (const line of newLines) {
      await trySendLineCompletionEmail({ user, line, items: itemRows, statusMap: nextStatusMap });
    }
  }

  return res.json({ ok: true });
});

app.post("/api/bingo/item/:id/image", authMiddleware, upload.single("image"), async (req, res) => {
  const userId = req.user.sub;
  const itemId = Number(req.params.id);
  if (!req.file || Number.isNaN(itemId)) {
    return res.status(400).json({ error: "Missing file or item id" });
  }

  const { rows: itemRows } = await query("SELECT id, label FROM bingo_items ORDER BY id ASC");
  const { rows: currentRows } = await query(
    "SELECT item_id, checked, image_url FROM user_item_status WHERE user_id = $1",
    [userId]
  );
  const statusMap = new Map(currentRows.map((row) => [row.item_id, row]));
  const beforeChecked = itemRows.map((item) => Boolean(statusMap.get(item.id)?.checked));
  const currentStatus = statusMap.get(itemId);

  if (!currentStatus?.checked) {
    const { rows: dailyRows } = await query(
      "SELECT count FROM user_daily_actions WHERE user_id = $1 AND action_date = CURRENT_DATE",
      [userId]
    );
    const count = dailyRows[0]?.count ?? 0;
    if (count >= MAX_DAILY_ACTIONS) {
      return res.status(429).json({ error: `Daily limit reached (${MAX_DAILY_ACTIONS}). Try again tomorrow.` });
    }
  }

  const key = `${userId}/${itemId}-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "")}`;
  const imageUrl = await storeImage({
    buffer: req.file.buffer,
    contentType: req.file.mimetype,
    key
  });

  await query(
    `INSERT INTO user_item_status (user_id, item_id, checked, image_url)
     VALUES ($1, $2, TRUE, $3)
     ON CONFLICT (user_id, item_id)
     DO UPDATE SET image_url = EXCLUDED.image_url, checked = TRUE, updated_at = NOW()` ,
    [userId, itemId, imageUrl]
  );

  if (!currentStatus?.checked) {
    await query(
      `INSERT INTO user_daily_actions (user_id, action_date, count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, action_date)
       DO UPDATE SET count = user_daily_actions.count + 1`,
      [userId]
    );
  }

  const nextStatusMap = new Map(statusMap);
  nextStatusMap.set(itemId, {
    ...(nextStatusMap.get(itemId) || { item_id: itemId }),
    checked: true,
    image_url: imageUrl
  });
  const afterChecked = itemRows.map((item) => Boolean(nextStatusMap.get(item.id)?.checked));
  const beforeLines = getCompletedLines(beforeChecked);
  const afterLines = getCompletedLines(afterChecked);
  const newLines = afterLines.filter((line) => !beforeLines.some((prev) => prev.key === line.key));

  if (afterChecked.every(Boolean)) {
    await query(
      `UPDATE users
       SET certificate_earned_at = COALESCE(certificate_earned_at, NOW())
       WHERE id = $1`,
      [userId]
    );
  }

  if (newLines.length > 0) {
    await recordLineCompletions(userId, newLines);
    const { rows: userRows } = await query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]);
    const user = userRows[0];
    for (const line of newLines) {
      await trySendLineCompletionEmail({ user, line, items: itemRows, statusMap: nextStatusMap });
    }
  }

  const storageSummary = await getStorageSummary();
  await trySendStorageWarning(storageSummary, "image upload");

  return res.json({ imageUrl, storage: storageSummary });
});

app.get("/api/leaderboard", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const { rows: itemRows } = await query("SELECT id FROM bingo_items ORDER BY id ASC");
  const itemIds = itemRows.map((row) => row.id);

  const { rows: users } = await query(
    "SELECT id, username, display_name, avatar_base, avatar_props FROM users"
  );
  const { rows: statuses } = await query(
    "SELECT user_id, item_id, checked, image_url FROM user_item_status"
  );

  const statusByUser = new Map();
  users.forEach((user) => {
    statusByUser.set(user.id, new Map());
  });
  statuses.forEach((row) => {
    if (!statusByUser.has(row.user_id)) {
      statusByUser.set(row.user_id, new Map());
    }
    statusByUser.get(row.user_id).set(row.item_id, row);
  });

  const ranked = users.map((user) => {
    const statusMap = statusByUser.get(user.id) || new Map();
    const checked = itemIds.map((itemId) => Boolean(statusMap.get(itemId)?.checked));
    const tilesCompleted = checked.filter(Boolean).length;
    const linesCompleted = countCompletedLines(checked, 5);
    return {
      id: user.id,
      username: user.username || user.display_name,
      linesCompleted,
      tilesCompleted,
      avatarBase: user.avatar_base,
      avatarProps: user.avatar_props || []
    };
  });

  ranked.sort((a, b) => {
    if (b.linesCompleted !== a.linesCompleted) return b.linesCompleted - a.linesCompleted;
    if (b.tilesCompleted !== a.tilesCompleted) return b.tilesCompleted - a.tilesCompleted;
    return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
  });

  return res.json({ users: ranked, currentUserId: userId });
});

app.delete("/api/bingo/item/:id/image", authMiddleware, async (req, res) => {
  const userId = req.user.sub;
  const itemId = Number(req.params.id);
  if (Number.isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid item id" });
  }

  await query(
    `INSERT INTO user_item_status (user_id, item_id, checked, image_url)
     VALUES ($1, $2, FALSE, NULL)
     ON CONFLICT (user_id, item_id)
     DO UPDATE SET checked = FALSE, image_url = NULL, updated_at = NOW()` ,
    [userId, itemId]
  );

  return res.json({ ok: true });
});

app.get("/api/admin/storage", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const summary = await getStorageSummary();
  return res.json(summary);
});

app.get("/api/admin/leaderboard", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { rows: itemRows } = await query("SELECT id FROM bingo_items ORDER BY id ASC");
  const itemIds = itemRows.map((row) => row.id);

  const { rows: users } = await query("SELECT id, email, display_name FROM users");
  const { rows: statuses } = await query(
    "SELECT user_id, item_id, checked, image_url FROM user_item_status"
  );

  const statusByUser = new Map();
  users.forEach((user) => {
    statusByUser.set(user.id, new Map());
  });
  statuses.forEach((row) => {
    if (!statusByUser.has(row.user_id)) {
      statusByUser.set(row.user_id, new Map());
    }
    statusByUser.get(row.user_id).set(row.item_id, row);
  });

  const ranked = users.map((user) => {
    const statusMap = statusByUser.get(user.id) || new Map();
    const checked = itemIds.map((itemId) => Boolean(statusMap.get(itemId)?.checked));
    const tilesCompleted = checked.filter(Boolean).length;
    const photoTiles = itemIds.reduce((count, itemId) => {
      const row = statusMap.get(itemId);
      return count + (row?.checked && row?.image_url ? 1 : 0);
    }, 0);
    const linesCompleted = countCompletedLines(checked, 5);

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      linesCompleted,
      tilesCompleted,
      photoTiles
    };
  });

  ranked.sort((a, b) => {
    if (b.linesCompleted !== a.linesCompleted) return b.linesCompleted - a.linesCompleted;
    if (b.tilesCompleted !== a.tilesCompleted) return b.tilesCompleted - a.tilesCompleted;
    if (b.photoTiles !== a.photoTiles) return b.photoTiles - a.photoTiles;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });

  return res.json({ users: ranked });
});

app.get("/api/admin/line-completions", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { rows } = await query(
    `SELECT lc.id,
            lc.user_id AS "userId",
            u.display_name AS "displayName",
            u.email,
            lc.line_key AS "lineKey",
            lc.line_label AS "lineLabel",
            lc.created_at AS "createdAt"
     FROM line_completions lc
     JOIN users u ON u.id = lc.user_id
     ORDER BY lc.created_at ASC, lc.id ASC`
  );

  return res.json({ completions: rows });
});

app.get("/api/admin/surveys", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { rows } = await query(
    `SELECT u.id,
            u.display_name AS "displayName",
            u.username,
            u.email,
            u.created_at AS "joinedAt",
            s.is_under_30 AS "isUnder30",
            s.age_range AS "ageRange",
            s.race,
            s.disability,
            s.sexual_orientation AS "sexualOrientation",
            s.rural,
            s.location,
            s.discovery_source AS "discoverySource",
            s.friend_referral_email AS "friendReferralEmail",
            s.cycat_referral_email AS "cycatReferralEmail",
            s.other_discovery AS "otherDiscovery",
            s.completed_at AS "completedAt",
            s.skipped_at AS "skippedAt",
            s.updated_at AS "updatedAt"
     FROM users u
     LEFT JOIN user_surveys s ON s.user_id = u.id
     ORDER BY
       CASE WHEN s.completed_at IS NULL THEN 1 ELSE 0 END,
       s.completed_at DESC NULLS LAST,
       u.created_at ASC`
  );

  return res.json({ users: rows });
});

app.get("/api/admin/users/:id/board", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const userId = req.params.id;
  const { rows: userRows } = await query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]);
  if (userRows.length === 0) return res.status(404).json({ error: "User not found" });

  const { rows: items } = await query("SELECT id, label FROM bingo_items ORDER BY id ASC");
  const { rows: state } = await query(
    "SELECT item_id, checked, image_url FROM user_item_status WHERE user_id = $1",
    [userId]
  );
  const { rows: lineCompletions } = await query(
    `SELECT line_key AS "lineKey",
            line_label AS "lineLabel",
            created_at AS "createdAt"
     FROM line_completions
     WHERE user_id = $1
     ORDER BY created_at ASC, id ASC`,
    [userId]
  );

  return res.json({ user: userRows[0], items, state, lineCompletions });
});

app.get("/api/admin/users", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { rows: itemRows } = await query("SELECT id FROM bingo_items ORDER BY id ASC");
  const itemIds = itemRows.map((row) => row.id);

  const { rows: users } = await query(
    "SELECT id, email, display_name, username, created_at FROM users ORDER BY created_at ASC"
  );
  const { rows: statuses } = await query(
    "SELECT user_id, item_id, checked, image_url FROM user_item_status"
  );

  const statusByUser = new Map();
  users.forEach((user) => {
    statusByUser.set(user.id, new Map());
  });
  statuses.forEach((row) => {
    if (!statusByUser.has(row.user_id)) {
      statusByUser.set(row.user_id, new Map());
    }
    statusByUser.get(row.user_id).set(row.item_id, row);
  });

  const requesterId = req.user.sub;
  const payload = users.map((user) => {
    const statusMap = statusByUser.get(user.id) || new Map();
    const checked = itemIds.map((itemId) => Boolean(statusMap.get(itemId)?.checked));
    const tilesCompleted = checked.filter(Boolean).length;
    const photoTiles = itemIds.reduce((count, itemId) => {
      const row = statusMap.get(itemId);
      return count + (row?.checked && row?.image_url ? 1 : 0);
    }, 0);
    const linesCompleted = countCompletedLines(checked, 5);
    const isAdmin = (user.email || "").toLowerCase() === adminEmail;

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      username: user.username,
      createdAt: user.created_at,
      linesCompleted,
      tilesCompleted,
      photoTiles,
      isAdmin,
      canDelete: !isAdmin && user.id !== requesterId
    };
  });

  return res.json({ users: payload });
});

app.delete("/api/admin/users/:id", authMiddleware, async (req, res) => {
  if (!isAdminRequester(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const userId = req.params.id;
  const { confirm } = req.body || {};
  if (confirm !== "DELETE") {
    return res.status(400).json({ error: "Confirmation required" });
  }
  if (userId === req.user.sub) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }

  const { rows } = await query("SELECT id, email FROM users WHERE id = $1", [userId]);
  if (rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const target = rows[0];
  if ((target.email || "").toLowerCase() === adminEmail) {
    return res.status(400).json({ error: "Cannot delete the primary admin account" });
  }

  await query("DELETE FROM users WHERE id = $1", [userId]);
  return res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err?.message === "INVALID_FILE_TYPE") {
    return res.status(400).json({ error: "Only image uploads are allowed" });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

async function bootstrap() {
  await ensureSchema();
  configureEmail();
  const labels = loadBingoLabels();
  await ensureItems(labels);

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}

bootstrap();
