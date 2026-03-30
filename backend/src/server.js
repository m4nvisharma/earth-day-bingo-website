import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import multer from "multer";
import { randomUUID } from "crypto";
import { query, ensureSchema, ensureItems } from "./db.js";
import { authMiddleware, signToken } from "./auth.js";
import { storeImage } from "./storage.js";

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

const adminEmail = (process.env.ADMIN_EMAIL || "manviisharma01@gmail.com").toLowerCase();

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

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/auth/signup", async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = randomUUID();
  await query(
    "INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)",
    [userId, email, passwordHash, displayName]
  );

  const token = signToken({ sub: userId, email });
  return res.json({ token, user: { id: userId, email, displayName } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const { rows } = await query("SELECT id, password_hash, display_name FROM users WHERE email = $1", [email]);
  if (rows.length === 0) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken({ sub: user.id, email });
  return res.json({ token, user: { id: user.id, email, displayName: user.display_name } });
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

  await query(
    `INSERT INTO user_item_status (user_id, item_id, checked)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, item_id)
     DO UPDATE SET checked = EXCLUDED.checked, updated_at = NOW()` ,
    [userId, itemId, checked]
  );

  return res.json({ ok: true });
});

app.post("/api/bingo/item/:id/image", authMiddleware, upload.single("image"), async (req, res) => {
  const userId = req.user.sub;
  const itemId = Number(req.params.id);
  if (!req.file || Number.isNaN(itemId)) {
    return res.status(400).json({ error: "Missing file or item id" });
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

  return res.json({ imageUrl });
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
  const labels = loadBingoLabels();
  await ensureItems(labels);

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}

bootstrap();
