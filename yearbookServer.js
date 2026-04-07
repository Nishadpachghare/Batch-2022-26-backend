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
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "yearbook.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const YEAR_OPTIONS = ["1st yr", "2nd yr", "3rd yr", "4th yr"];
const MAX_FILE_SIZE = 600 * 1024 * 1024;

const app = express();

// ✅ CORS MIDDLEWARE - MUST BE FIRST - before everything else
// app.use((req, res, next) => {
//   res.header("Access-Control-Allow-Origin", "*");
//   res.header("Access-Control-Allow-Credentials", "true");
//   res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE");
//   res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-access-token, x-refresh-token");
  
//   if (req.method === "OPTIONS") {
//     return res.sendStatus(204);
//   }
//   next();
// });
const corsOptions = {
  origin: [
    
    "https://batch-2022-26-navy.vercel.app/",
    "http://localhost:3000",
  ],
  // origin:'*',
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
//middleware
app.use(express.json({ limit: '50mb' }));

app.use(cors(corsOptions));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

let storageMode = "file";
let storageInitialized = false;
let memoryFallbackData = null;

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

app.use(express.json({ limit: "600mb" }));
app.use(express.urlencoded({ limit: "600mb", extended: true }));
app.use("/uploads", express.static(UPLOADS_DIR));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path}`);
  next();
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
const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);

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

function createSeedMedia() {
  // No demo media - users upload their own
  return [];
}

function createSeedMessages() {
  // No demo messages - users create their own
  return [];
}

function createLocalSeedData() {
  return {
    students: createSeedStudents().map((student) => ({
      _id: crypto.randomUUID(),
      ...student,
    })),
    media: createSeedMedia().map((item) => ({
      _id: crypto.randomUUID(),
      ...item,
    })),
    messages: createSeedMessages().map((message) => ({
      _id: crypto.randomUUID(),
      ...message,
    })),
  };
}

function sanitizeLocalData(data) {
  return {
    students: Array.isArray(data?.students) ? data.students : [],
    media: Array.isArray(data?.media) ? data.media : [],
    messages: Array.isArray(data?.messages) ? data.messages : [],
  };
}

function normalizeYear(year) {
  return YEAR_OPTIONS.includes(year) ? year : "1st yr";
}

function buildFallbackImage(seed) {
  const safeSeed = encodeURIComponent(String(seed || "student"));
  return `https://picsum.photos/seed/${safeSeed}/300/400`;
}

function sortByRoll(left, right) {
  const leftRoll = Number.parseInt(String(left.roll).replace(/\D/g, ""), 10);
  const rightRoll = Number.parseInt(String(right.roll).replace(/\D/g, ""), 10);

  if (!Number.isNaN(leftRoll) && !Number.isNaN(rightRoll)) {
    return leftRoll - rightRoll;
  }

  return String(left.roll).localeCompare(String(right.roll), undefined, {
    numeric: true,
  });
}

function normalizeRecord(record) {
  const plain =
    typeof record?.toObject === "function" ? record.toObject() : { ...record };

  if (!plain) {
    return null;
  }

  if (plain._id !== undefined) {
    plain._id = String(plain._id);
  }

  if (plain.createdAt) {
    plain.createdAt = new Date(plain.createdAt).toISOString();
  }

  if (plain.updatedAt) {
    plain.updatedAt = new Date(plain.updatedAt).toISOString();
  }

  if (plain.uploadedAt) {
    plain.uploadedAt = new Date(plain.uploadedAt).toISOString();
  }

  return plain;
}

async function ensureLocalStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  try {
    const existing = await fs.readFile(DATA_FILE, "utf8");
    const parsed = sanitizeLocalData(JSON.parse(existing));
    await fs.writeFile(DATA_FILE, JSON.stringify(parsed, null, 2));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Local data file was missing or invalid. Recreating it.");
    }

    const initialData = createLocalSeedData();
    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
    memoryFallbackData = initialData;
  }
}

async function readLocalData() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return sanitizeLocalData(JSON.parse(raw));
  } catch (error) {
    if (!memoryFallbackData) {
      memoryFallbackData = createLocalSeedData();
    }

    console.warn(
      "⚠️ Falling back to in-memory seed data because local data file could not be read:",
      error.message,
    );
    return sanitizeLocalData(memoryFallbackData);
  }
}

async function writeLocalData(data) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    memoryFallbackData = data;
    console.log("✅ Data persisted to file successfully");
  } catch (error) {
    memoryFallbackData = data;
    console.warn(
      "⚠️ Local data file could not be written. Keeping changes in memory:",
      error.message,
    );
  }
}

async function seedMongoCollection(Model, items) {
  const count = await Model.countDocuments();

  if (count === 0) {
    await Model.insertMany(items);
  }
}

async function cleanupOldSeedMedia() {
  // Remove all archive/demo media (uploaded by "Archive")
  try {
    const result = await Media.deleteMany({ uploadedBy: "Archive" });
    if (result.deletedCount > 0) {
      console.log(`🗑️  Cleaned up ${result.deletedCount} demo media items`);
    }
  } catch (error) {
    console.warn("Could not cleanup old seed media:", error.message);
  }
}

async function cleanupOldSeedMessages() {
  // ⚠️ IMPORTANT: Do NOT delete user messages!
  // Since createSeedMessages() returns an empty array, there are NO demo messages to clean up
  // Only delete messages that have an explicit seed marker (which we don't use)
  // This prevents accidental deletion of user-posted messages on server restart
  try {
    // Only delete messages with a specific seed marker that would never be on real user messages
    const result = await Message.deleteMany({
      fromName: "SEED_DEMO_MESSAGE_DO_NOT_KEEP",
    });
    if (result.deletedCount > 0) {
      console.log(`🗑️  Cleaned up ${result.deletedCount} demo messages`);
    }
  } catch (error) {
    console.warn("Could not cleanup old seed messages:", error.message);
  }
}

async function initializeStorage() {
  if (storageInitialized) {
    return storageMode;
  }

  console.log("🚀 Initializing storage layer...");
  await ensureLocalStorage();

  try {
    console.log("🔌 Attempting to connect to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 4000,
    });

    storageMode = "mongo";
    console.log("✅ MongoDB Connected Successfully!");
    console.log("📊 Data will be stored in MongoDB Cloud");

    // Clean up old demo data (only data with specific seed markers)
    await cleanupOldSeedMedia();
    await cleanupOldSeedMessages();

    await Promise.all([
      seedMongoCollection(Student, createSeedStudents()),
      seedMongoCollection(Media, createSeedMedia()),
      seedMongoCollection(Message, createSeedMessages()),
    ]);

    console.log("✅ MongoDB initialized with seed data (if needed)");
  } catch (error) {
    storageMode = "file";
    console.warn("⚠️  MongoDB failed to connect:", error.message);
    console.log("📁 Switching to local JSON file storage");
    console.log("📁 Data will be stored in: " + DATA_FILE);
  }

  storageInitialized = true;
  console.log(`✅ Storage mode: ${storageMode.toUpperCase()}`);
  return storageMode;
}

async function listStudents() {
  if (storageMode === "mongo") {
    const students = await Student.find().sort({ roll: 1, name: 1 });
    return students.map(normalizeRecord);
  }

  const data = await readLocalData();
  return [...data.students].sort(sortByRoll).map(normalizeRecord);
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

  if (storageMode === "mongo") {
    const createdStudent = await Student.create(student);
    return normalizeRecord(createdStudent);
  }

  const data = await readLocalData();
  const createdStudent = {
    _id: crypto.randomUUID(),
    ...student,
  };
  data.students.push(createdStudent);
  await writeLocalData(data);
  return normalizeRecord(createdStudent);
}

async function updateStudentRecord(studentId, updates) {
  const preparedUpdates = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  if (storageMode === "mongo") {
    const updatedStudent = await Student.findByIdAndUpdate(
      studentId,
      preparedUpdates,
      {
        new: true,
        runValidators: true,
      },
    );
    return normalizeRecord(updatedStudent);
  }

  const data = await readLocalData();
  const studentIndex = data.students.findIndex(
    (student) => student._id === studentId,
  );

  if (studentIndex === -1) {
    return null;
  }

  const updatedStudent = {
    ...data.students[studentIndex],
    ...preparedUpdates,
  };
  data.students[studentIndex] = updatedStudent;
  await writeLocalData(data);

  return normalizeRecord(updatedStudent);
}

async function deleteStudentRecord(studentId) {
  if (storageMode === "mongo") {
    const deletedStudent = await Student.findByIdAndDelete(studentId);
    return normalizeRecord(deletedStudent);
  }

  const data = await readLocalData();
  const studentIndex = data.students.findIndex(
    (student) => student._id === studentId,
  );

  if (studentIndex === -1) {
    return null;
  }

  const [deletedStudent] = data.students.splice(studentIndex, 1);
  await writeLocalData(data);

  return normalizeRecord(deletedStudent);
}

async function listMedia(filters = {}) {
  if (storageMode === "mongo") {
    const query = {};

    if (filters.year) {
      query.year = filters.year;
    }

    if (filters.studentId) {
      query.studentId = filters.studentId;
    }

    const media = await Media.find(query).sort({ uploadedAt: -1 });
    return media.map(normalizeRecord);
  }

  const data = await readLocalData();
  let media = [...data.media];

  if (filters.year) {
    media = media.filter((item) => item.year === filters.year);
  }

  if (filters.studentId) {
    media = media.filter((item) => item.studentId === filters.studentId);
  }

  return media
    .sort((left, right) => {
      return new Date(right.uploadedAt) - new Date(left.uploadedAt);
    })
    .map(normalizeRecord);
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

  if (storageMode === "mongo") {
    const createdMedia = await Media.create(mediaRecord);
    return normalizeRecord(createdMedia);
  }

  const data = await readLocalData();
  const createdMedia = {
    _id: crypto.randomUUID(),
    ...mediaRecord,
  };
  data.media.unshift(createdMedia);
  await writeLocalData(data);

  return normalizeRecord(createdMedia);
}

async function listMessages(filters = {}) {
  function sanitizeMessage(message) {
    const normalized = normalizeRecord(message);

    if (!normalized) {
      return null;
    }

    return {
      _id: normalized._id,
      content: normalized.content,
      createdAt: normalized.createdAt,
    };
  }

  if (storageMode === "mongo") {
    const query = {};

    if (filters.toStudentId) {
      query.toStudentId = filters.toStudentId;
    }

    const messages = await Message.find(query).sort({ createdAt: -1 });
    console.log(`📨 Retrieved ${messages.length} message(s) from MongoDB`);
    return messages.map(sanitizeMessage).filter(Boolean);
  }

  const data = await readLocalData();
  let messages = [...data.messages];

  if (filters.toStudentId) {
    messages = messages.filter(
      (message) => message.toStudentId === filters.toStudentId,
    );
  }

  const sorted = messages
    .sort((left, right) => {
      return new Date(right.createdAt) - new Date(left.createdAt);
    })
    .map(sanitizeMessage)
    .filter(Boolean);
    
  console.log(`📨 Retrieved ${sorted.length} message(s) from JSON file`);
  return sorted;
}

async function createMessageRecord(payload) {
  const messageRecord = {
    content: payload.content.trim(),
    toName: (payload.toName || "The Wall").trim() || "The Wall",
    toStudentId: (payload.toStudentId || "").trim(),
    createdAt: new Date().toISOString(),
  };

  if (storageMode === "mongo") {
    const createdMessage = await Message.create(messageRecord);
    console.log(`✅ Message saved to MongoDB: "${messageRecord.content.substring(0, 50)}..."`);
    return normalizeRecord(createdMessage);
  }

  const data = await readLocalData();
  const createdMessage = {
    _id: crypto.randomUUID(),
    ...messageRecord,
  };
  data.messages.unshift(createdMessage);
  await writeLocalData(data);
  console.log(`✅ Message saved to JSON file: "${messageRecord.content.substring(0, 50)}..."`);

  return normalizeRecord(createdMessage);
}

function getFileExtension(file) {
  const originalExtension = path.extname(file.originalname || "");

  if (originalExtension) {
    return originalExtension.toLowerCase();
  }

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
          {
            folder: `yearbook/${folder}`,
            resource_type: "auto",
          },
          (error, uploadedFile) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(uploadedFile);
          },
        );

        stream.end(file.buffer);
      });

      return {
        url: result.secure_url,
        resourceType: result.resource_type || "image",
        mimeType: file.mimetype || "",
      };
    } catch (error) {
      console.warn(
        `Cloudinary upload failed, saving locally instead. ${error.message}`,
      );
    }
  }

  return saveFileLocally(file, req, folder);
}

app.get("/", (req, res) => {
  res.json({
    message: "Batch 2022-26 Yearbook API is running.",
    storageMode,
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    storageMode,
  });
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
    const studentId = req.params.id;

    if (storageMode === "mongo") {
      const student = await Student.findById(studentId);

      if (!student) {
        return res.status(404).json({ error: "Student not found." });
      }

      return res.json(normalizeRecord(student));
    }

    const data = await readLocalData();
    const student = data.students.find((s) => s._id === studentId);

    if (!student) {
      return res.status(404).json({ error: "Student not found." });
    }

    res.json(normalizeRecord(student));
  } catch (error) {
    next(error);
  }
});

app.post("/api/students", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const roll = String(req.body.roll || "").trim();

    if (!name || !roll) {
      return res
        .status(400)
        .json({ error: "Student name and roll number are required." });
    }

    const student = await createStudentRecord({
      name,
      roll,
      year: req.body.year,
      email: req.body.email,
      image: req.body.image,
    });

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

      if (!name) {
        return res.status(400).json({ error: "Display name cannot be empty." });
      }

      updates.name = name;
    }

    if (Object.hasOwn(req.body, "roll")) {
      const roll = String(req.body.roll || "").trim();

      if (!roll) {
        return res.status(400).json({ error: "Roll number cannot be empty." });
      }

      updates.roll = roll;
    }

    if (Object.hasOwn(req.body, "year")) {
      updates.year = normalizeYear(req.body.year);
    }

    if (Object.hasOwn(req.body, "email")) {
      updates.email = String(req.body.email || "").trim();
    }

    if (req.file) {
      if (!req.file.mimetype?.startsWith("image/")) {
        return res
          .status(400)
          .json({ error: "Profile picture must be an image file." });
      }

      const uploadedImage = await uploadAsset(req.file, req, "profiles");
      updates.image = uploadedImage.url;
    }

    const updatedStudent = await updateStudentRecord(studentId, updates);

    if (!updatedStudent) {
      return res.status(404).json({ error: "Student not found." });
    }

    res.json(updatedStudent);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/students/:id", async (req, res, next) => {
  try {
    const deletedStudent = await deleteStudentRecord(req.params.id);

    if (!deletedStudent) {
      return res.status(404).json({ error: "Student not found." });
    }

    res.json({ message: "Student deleted successfully." });
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

app.post(
  ["/api/media", "/api/upload"],
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Choose a photo or video before uploading." });
      }

      const uploadedAsset = await uploadAsset(req.file, req, "memories");
      const year = normalizeYear(req.body.year || req.body.category);
      const media = await createMediaRecord({
        url: uploadedAsset.url,
        caption:
          String(req.body.caption || "").trim() ||
          `${String(req.body.studentName || "Class memory").trim()} - ${year}`,
        category: year,
        year,
        uploadedBy:
          String(req.body.uploadedBy || "").trim() ||
          String(req.body.studentName || "").trim() ||
          "Anonymous",
        studentId: String(req.body.studentId || "").trim(),
        studentName: String(req.body.studentName || "").trim(),
        resourceType: uploadedAsset.resourceType,
        mimeType: uploadedAsset.mimeType,
      });

      res.status(201).json(media);
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/messages", async (req, res, next) => {
  try {
    const messages = await listMessages({
      toStudentId: req.query.toStudentId
        ? String(req.query.toStudentId)
        : undefined,
    });
    res.json(messages);
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages", async (req, res, next) => {
  try {
    const content = String(req.body.content || "").trim();

    if (!content) {
      return res.status(400).json({ error: "Message content is required." });
    }

    if (content.length > 280) {
      return res
        .status(400)
        .json({ error: "Message must be 280 characters or fewer." });
    }

    const message = await createMessageRecord({
      content,
      toName: req.body.toName,
      toStudentId: req.body.toStudentId,
    });

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

// 🌱 Seed all 75 classmates
app.post("/api/seed-students", async (req, res, next) => {
  try {
    const seedData = createSeedStudents();
    let addedCount = 0;
    let skippedCount = 0;

    for (const studentData of seedData) {
      try {
        if (storageMode === "mongo") {
          // Check if student already exists by roll number
          const existing = await Student.findOne({ roll: studentData.roll });
          if (!existing) {
            await Student.create(studentData);
            addedCount++;
          } else {
            skippedCount++;
          }
        } else {
          // Local storage mode
          const data = await readLocalData();
          const exists = data.students.some((s) => s.roll === studentData.roll);
          if (!exists) {
            const newStudent = {
              _id: crypto.randomUUID(),
              ...studentData,
            };
            data.students.push(newStudent);
            await writeLocalData(data);
            addedCount++;
          } else {
            skippedCount++;
          }
        }
      } catch (err) {
        console.error(`Failed to seed student with roll ${studentData.roll}:`, err.message);
      }
    }

    res.json({
      message: "Seeding completed",
      added: addedCount,
      skipped: skippedCount,
      total: seedData.length,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File is too large. Maximum size is 25 MB." });
    }

    return res.status(400).json({ error: error.message });
  }

  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: error.message });
  }

  console.error("Yearbook API error:", error);
  return res.status(500).json({
    error: "Something went wrong while processing the request.",
  });
});

async function startServer() {
  const activeStorageMode = await initializeStorage();

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Yearbook API listening on http://localhost:${PORT}`);
      console.log(`API ready at http://localhost:${PORT}/api`);
      console.log(`Storage mode: ${activeStorageMode}`);
      resolve(server);
    });
  });
}

if (process.argv[1] === __filename) {
  startServer().catch((error) => {
    console.error("Failed to start the Yearbook API:", error);
    process.exit(1);
  });
}

export { app, initializeStorage, startServer };
export default app;
