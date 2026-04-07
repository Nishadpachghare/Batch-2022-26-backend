import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const UPLOADS_DIR = path.join(__dirname, "uploads");
const YEAR_OPTIONS = ["1st yr", "2nd yr", "3rd yr", "4th yr"];
const MAX_FILE_SIZE = 600 * 1024 * 1024;

const app = express();

// ✅ STEP 1: CORS must be the VERY FIRST middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  // ✅ STEP 2: OPTIONS preflight must return 200 immediately
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// ✅ STEP 3: cors package as backup
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"],
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

let storageInitialized = false;

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_NAME &&
    process.env.CLOUDINARY_KEY &&
    process.env.CLOUDINARY_SECRET &&
    process.env.CLOUDINARY_NAME !== "YOUR_NAME" &&
    process.env.CLOUDINARY_KEY !== "YOUR_KEY" &&
    process.env.CLOUDINARY_SECRET !== "YOUR_SECRET",
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });
}

app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path}`);
  next();
});

const storageInitPromise = initializeStorage().catch((error) => {
  console.error("Storage initialization error:", error.message);
  throw error;
});

app.use(async (req, res, next) => {
  if (req.path === "/api/health" || req.path === "/") return next();
  try {
    await storageInitPromise;
    next();
  } catch {
    return res.status(503).json({ error: "Database connection failed." });
  }
});

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    roll: { type: String, required: true, trim: true },
    image: { type: String, default: "" },
    year: { type: String, default: "1st yr" },
    email: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    caption: { type: String, default: "Memory" },
    category: { type: String, default: "1st yr" },
    year: { type: String, default: "1st yr" },
    uploadedBy: { type: String, default: "Anonymous" },
    studentId: { type: String, default: "" },
    studentName: { type: String, default: "" },
    resourceType: { type: String, default: "image" },
    mimeType: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

const messageSchema = new mongoose.Schema(
  {
    content: { type: String, required: true, trim: true },
    fromName: { type: String, default: "Anonymous" },
    toName: { type: String, default: "The Wall" },
    toStudentId: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

const Student = mongoose.models.Student || mongoose.model("Student", studentSchema);
const Media = mongoose.models.Media || mongoose.model("Media", mediaSchema);
const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function createSeedStudents() {
  return Array.from({ length: 75 }, (_, index) => {
    const number = index + 1;
    const seed = String(number).padStart(3, "0");
    return {
      name: `Classmate ${number}`,
      roll: seed,
      image: `https://picsum.photos/seed/student${number}/300/400`,
      year: YEAR_OPTIONS[index % YEAR_OPTIONS.length],
      email: `classmate${number}@batch26.local`,
      createdAt: daysAgo(90 - index),
      updatedAt: daysAgo(90 - index),
    };
  });
}

function normalizeYear(year) {
  return YEAR_OPTIONS.includes(year) ? year : "1st yr";
}

function buildFallbackImage(seed) {
  const safeSeed = encodeURIComponent(String(seed || "student"));
  return `https://picsum.photos/seed/${safeSeed}/300/400`;
}

function normalizeRecord(record) {
  const plain = typeof record?.toObject === "function" ? record.toObject() : { ...record };
  if (!plain) return null;
  if (plain._id !== undefined) plain._id = String(plain._id);
  if (plain.createdAt) plain.createdAt = new Date(plain.createdAt).toISOString();
  if (plain.updatedAt) plain.updatedAt = new Date(plain.updatedAt).toISOString();
  if (plain.uploadedAt) plain.uploadedAt = new Date(plain.uploadedAt).toISOString();
  return plain;
}

async function seedMongoCollection(Model, items) {
  const count = await Model.countDocuments();
  if (count === 0) await Model.insertMany(items);
}

async function initializeStorage() {
  if (storageInitialized) return;
  console.log("🚀 Initializing MongoDB connection...");
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      retryWrites: true,
    });
    console.log("✅ MongoDB Connected!");
    await Promise.all([
      seedMongoCollection(Student, createSeedStudents()),
      seedMongoCollection(Media, []),
      seedMongoCollection(Message, []),
    ]);
    console.log("✅ Database ready");
  } catch (error) {
    console.error("❌ MongoDB Failed:", error.message);
    throw new Error("Database connection required");
  }
  storageInitialized = true;
}

async function listStudents() {
  const students = await Student.find().sort({ roll: 1, name: 1 });
  return students.map(normalizeRecord);
}

async function createStudentRecord(payload) {
  const student = {
    name: payload.name.trim(),
    roll: payload.roll.trim(),
    image: payload.image || buildFallbackImage(payload.roll),
    year: normalizeYear(payload.year || "1st yr"),
    email: (payload.email || "").trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const createdStudent = await Student.create(student);
  return normalizeRecord(createdStudent);
}

async function updateStudentRecord(studentId, updates) {
  const preparedUpdates = { ...updates, updatedAt: new Date().toISOString() };
  const updatedStudent = await Student.findByIdAndUpdate(studentId, preparedUpdates, {
    new: true,
    runValidators: true,
  });
  return normalizeRecord(updatedStudent);
}

async function deleteStudentRecord(studentId) {
  const deletedStudent = await Student.findByIdAndDelete(studentId);
  return normalizeRecord(deletedStudent);
}

async function listMedia(filters = {}) {
  const query = {};
  if (filters.year) query.year = filters.year;
  if (filters.studentId) query.studentId = filters.studentId;
  const media = await Media.find(query).sort({ uploadedAt: -1 });
  return media.map(normalizeRecord);
}

async function createMediaRecord(payload) {
  const mediaRecord = {
    url: payload.url,
    caption: payload.caption,
    category: payload.category,
    year: payload.year,
    uploadedBy: payload.uploadedBy,
    studentId: payload.studentId || "",
    studentName: payload.studentName || "",
    resourceType: payload.resourceType || "image",
    mimeType: payload.mimeType || "",
    uploadedAt: new Date().toISOString(),
  };
  const createdMedia = await Media.create(mediaRecord);
  return normalizeRecord(createdMedia);
}

async function listMessages(filters = {}) {
  function sanitizeMessage(message) {
    const normalized = normalizeRecord(message);
    if (!normalized) return null;
    return { _id: normalized._id, content: normalized.content, createdAt: normalized.createdAt };
  }
  const query = {};
  if (filters.toStudentId) query.toStudentId = filters.toStudentId;
  const messages = await Message.find(query).sort({ createdAt: -1 });
  return messages.map(sanitizeMessage).filter(Boolean);
}

async function createMessageRecord(payload) {
  const messageRecord = {
    content: payload.content.trim(),
    toName: (payload.toName || "The Wall").trim() || "The Wall",
    toStudentId: (payload.toStudentId || "").trim(),
    createdAt: new Date().toISOString(),
  };
  const createdMessage = await Message.create(messageRecord);
  return normalizeRecord(createdMessage);
}

function getFileExtension(file) {
  const originalExtension = path.extname(file.originalname || "");
  if (originalExtension) return originalExtension.toLowerCase();
  const subtype = (file.mimetype || "application/octet-stream").split("/")[1];
  const safeSubtype = subtype.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `.${safeSubtype}`;
}

async function saveFileLocally(file, req, folder) {
  const folderPath = path.join(UPLOADS_DIR, folder);
  await fs.mkdir(folderPath, { recursive: true });
  const extension = getFileExtension(file);
  const fileName = `${folder}-${Date.now()}-${crypto.randomUUID()}${extension}`;
  const destination = path.join(folderPath, fileName);
  await fs.writeFile(destination, file.buffer);
  return {
    url: `${req.protocol}://${req.get("host")}/uploads/${folder}/${fileName}`,
    resourceType: file.mimetype?.startsWith("video/") ? "video" : "image",
    mimeType: file.mimetype || "",
  };
}

async function uploadAsset(file, req, folder) {
  if (cloudinaryConfigured) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `yearbook/${folder}`, resource_type: "auto" },
          (error, uploadedFile) => {
            if (error) reject(error);
            else resolve(uploadedFile);
          }
        );
        stream.end(file.buffer);
      });
      return {
        url: result.secure_url,
        resourceType: result.resource_type || "image",
        mimeType: file.mimetype || "",
      };
    } catch (error) {
      console.warn(`Cloudinary failed: ${error.message}`);
    }
  }
  return saveFileLocally(file, req, folder);
}

// ── ROUTES ──────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ message: "Batch 2022-26 Yearbook API is running." });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/students", async (req, res, next) => {
  try {
    const students = await listStudents();
    res.json(students);
  } catch (error) {
    next(error);
  }
});

app.get("/api/students/:id", async (req, res, next) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: "Student not found." });
    res.json(normalizeRecord(student));
  } catch (error) {
    next(error);
  }
});

app.post("/api/students", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const roll = String(req.body.roll || "").trim();
    if (!name || !roll) return res.status(400).json({ error: "Name and roll required." });
    const student = await createStudentRecord({ name, roll, year: req.body.year, email: req.body.email, image: req.body.image });
    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/students/:id", upload.single("image"), async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const updates = {};
    if (Object.hasOwn(req.body, "name")) {
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Name cannot be empty." });
      updates.name = name;
    }
    if (Object.hasOwn(req.body, "roll")) {
      const roll = String(req.body.roll || "").trim();
      if (!roll) return res.status(400).json({ error: "Roll cannot be empty." });
      updates.roll = roll;
    }
    if (Object.hasOwn(req.body, "year")) updates.year = normalizeYear(req.body.year);
    if (Object.hasOwn(req.body, "email")) updates.email = String(req.body.email || "").trim();
    if (req.file) {
      if (!req.file.mimetype?.startsWith("image/")) {
        return res.status(400).json({ error: "Must be image." });
      }
      const uploadedImage = await uploadAsset(req.file, req, "profiles");
      updates.image = uploadedImage.url;
    }
    const updatedStudent = await updateStudentRecord(studentId, updates);
    if (!updatedStudent) return res.status(404).json({ error: "Student not found." });
    res.json(updatedStudent);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/students/:id", async (req, res, next) => {
  try {
    const deletedStudent = await deleteStudentRecord(req.params.id);
    if (!deletedStudent) return res.status(404).json({ error: "Student not found." });
    res.json({ message: "Deleted successfully." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/media", async (req, res, next) => {
  try {
    const media = await listMedia({
      year: req.query.year ? normalizeYear(req.query.year) : undefined,
      studentId: req.query.studentId ? String(req.query.studentId) : undefined,
    });
    res.json(media);
  } catch (error) {
    next(error);
  }
});

app.post(["/api/media", "/api/upload"], upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a file before uploading." });
    const uploadedAsset = await uploadAsset(req.file, req, "memories");
    const year = normalizeYear(req.body.year || req.body.category);
    const media = await createMediaRecord({
      url: uploadedAsset.url,
      caption: String(req.body.caption || "").trim() || `${String(req.body.studentName || "Memory").trim()} - ${year}`,
      category: year,
      year,
      uploadedBy: String(req.body.uploadedBy || "").trim() || String(req.body.studentName || "").trim() || "Anonymous",
      studentId: String(req.body.studentId || "").trim(),
      studentName: String(req.body.studentName || "").trim(),
      resourceType: uploadedAsset.resourceType,
      mimeType: uploadedAsset.mimeType,
    });
    res.status(201).json(media);
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages", async (req, res, next) => {
  try {
    const messages = await listMessages({
      toStudentId: req.query.toStudentId ? String(req.query.toStudentId) : undefined,
    });
    res.json(messages);
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages", async (req, res, next) => {
  try {
    const content = String(req.body.content || "").trim();
    if (!content) return res.status(400).json({ error: "Message required." });
    if (content.length > 280) return res.status(400).json({ error: "Max 280 chars." });
    const message = await createMessageRecord({ content, toName: req.body.toName, toStudentId: req.body.toStudentId });
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

app.post("/api/seed-students", async (req, res, next) => {
  try {
    const seedData = createSeedStudents();
    let addedCount = 0, skippedCount = 0;
    for (const studentData of seedData) {
      try {
        const existing = await Student.findOne({ roll: studentData.roll });
        if (!existing) { await Student.create(studentData); addedCount++; }
        else skippedCount++;
      } catch (err) {
        console.error(`Failed to seed roll ${studentData.roll}:`, err.message);
      }
    }
    res.json({ message: "Seeding completed", added: addedCount, skipped: skippedCount, total: seedData.length });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "File too large. Max 5MB." });
    return res.status(400).json({ error: error.message });
  }
  console.error("API error:", error);
  return res.status(500).json({ error: "Something went wrong." });
});

async function startServer() {
  await storageInitPromise;
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Yearbook API listening on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

if (process.argv[1] === __filename) {
  startServer().catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });
}

export { app, initializeStorage, startServer };
export default app;