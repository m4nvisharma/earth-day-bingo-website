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
const usernameBlocklistPath = path.resolve(__dirname, "../../content/username_blocklist.txt");
const MAX_DAILY_ACTIONS = Number(process.env.MAX_DAILY_ACTIONS || 4);

const baseBlocked = [
  "admin",
  "support",
  "moderator",
  "staff",
  "cycat",
  "glocal",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "dick",
  "porn",
  "sex"
];

function loadUsernameBlocklist() {
  try {
    if (!fs.existsSync(usernameBlocklistPath)) return baseBlocked;
    const content = fs.readFileSync(usernameBlocklistPath, "utf8");
    const extra = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return [...new Set([...baseBlocked, ...extra].map((word) => word.toLowerCase()))];
  } catch (error) {
    console.warn("Unable to read username blocklist; using base list.");
    return baseBlocked;
  }
}

function validateUsername(raw) {
  const username = String(raw || "").trim();
  if (!/^[a-zA-Z0-9]{4,}$/.test(username)) {
    return { ok: false, reason: "Username must be at least 4 characters and contain only letters and numbers." };
  }
  const lowered = username.toLowerCase();
  const blocklist = loadUsernameBlocklist();
  if (blocklist.some((blocked) => blocked && lowered.includes(blocked))) {
    return { ok: false, reason: "That username is not allowed. Please choose another." };
  }
  return { ok: true, username };
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
    const { rows: userRows } = await query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]);
    const user = userRows[0];
    for (const line of newLines) {
      await trySendLineCompletionEmail({ user, line, items: itemRows, statusMap: nextStatusMap });
    }
  }

  return res.json({ imageUrl });
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
     DO UPDATE SET image_url = NULL, updated_at = NOW()` ,
    [userId, itemId]
  );

  return res.json({ ok: true });
});

app.get("/api/admin/leaderboard", authMiddleware, async (req, res) => {
  const requesterEmail = (req.user?.email || "").toLowerCase();
  if (requesterEmail !== adminEmail) {
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

app.get("/api/admin/users/:id/board", authMiddleware, async (req, res) => {
  const requesterEmail = (req.user?.email || "").toLowerCase();
  if (requesterEmail !== adminEmail) {
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

  return res.json({ user: userRows[0], items, state });
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
