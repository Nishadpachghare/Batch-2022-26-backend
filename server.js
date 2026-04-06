import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || "YOUR_NAME",
  api_key: process.env.CLOUDINARY_KEY || "YOUR_KEY",
  api_secret: process.env.CLOUDINARY_SECRET || "YOUR_SECRET",
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yearbook";

let mongoConnected = false;

mongoose
  .connect(MONGODB_URI, {
    retryWrites: true,
    w: "majority",
  })
  .then(async () => {
    mongoConnected = true;
    console.log("✅ MongoDB Connected");
    
    // Smart seeding - only seed if collections are empty
    try {
      const studentCount = await Student.countDocuments();
      
      if (studentCount === 0) {
        console.log("📊 Database is empty. Seeding with 75 classmates (one time only)...");
        const seedStudents = Array.from({ length: 75 }, (_, i) => ({
          name: `Classmate ${i + 1}`,
          roll: i + 1,
          image: `https://picsum.photos/seed/student${i + 1}/300/400`,
          year: ["1st yr", "2nd yr", "3rd yr", "4th yr"][i % 4],
          email: `student${i + 1}@batch26.local`,
        }));
        
        const result = await Student.insertMany(seedStudents);
        console.log(`✅ Database seeded with ${result.length} students (ONE TIME ONLY)`);
      } else {
        console.log(`✅ Database already has ${studentCount} students. Seeding skipped.`);
      }
    } catch (seedError) {
      console.error("❌ Error during setup:", seedError.message);
    }
  })
  .catch((err) => {
    mongoConnected = false;
    console.error("❌ MongoDB Error:", err.message);
    console.error("URI:", MONGODB_URI);
  });

// ================= SCHEMAS =================

const studentSchema = new mongoose.Schema({
  name: String,
  roll: Number,
  image: String,
  year: String,
  email: String,
  createdAt: { type: Date, default: Date.now },
});

const mediaSchema = new mongoose.Schema({
  url: String,
  caption: String,
  year: String,
  category: String,
  uploadedBy: String,
  uploadedAt: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  content: String,
  fromName: String,
  toName: String,
  createdAt: { type: Date, default: Date.now },
});

// ================= MODELS =================

const Student = mongoose.model("Student", studentSchema);
const Media = mongoose.model("Media", mediaSchema);
const Message = mongoose.model("Message", messageSchema);

// ================= MULTER SETUP =================

const upload = multer({ storage: multer.memoryStorage() });

// ================= ROUTES =================

// 📚 Students Routes
app.get("/api/students", async (req, res) => {
  try {
    const students = await Student.find().sort({ roll: 1 });
    console.log(`✅ Returning ${students.length} students from MongoDB`);
    res.json(students);
  } catch (error) {
    console.error("❌ Error fetching students:", error.message);
    res.status(500).json({ error: "Error fetching students" });
  }
});

app.post("/api/students", async (req, res) => {
  try {
    const newStudent = new Student(req.body);
    await newStudent.save();
    console.log("✅ Student saved to MongoDB:", newStudent._id, "-", newStudent.name);
    res.json(newStudent);
  } catch (error) {
    console.error("❌ Error creating student:", error.message);
    res.status(500).json({ error: "Error creating student", details: error.message });
  }
});

app.patch("/api/students/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};

    // Handle text fields
    if (req.body.name !== undefined) {
      updateData.name = req.body.name;
    }
    if (req.body.roll !== undefined) {
      updateData.roll = req.body.roll;
    }
    if (req.body.year !== undefined) {
      updateData.year = req.body.year;
    }
    if (req.body.email !== undefined) {
      updateData.email = req.body.email;
    }

    // Handle image upload to Cloudinary
    if (req.file) {
      try {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "yearbook/students",
              resource_type: "auto",
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );

          stream.end(req.file.buffer);
        });

        updateData.image = result.secure_url;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(400).json({ error: "Failed to upload image" });
      }
    }

    // Try to update existing student
    let updatedStudent = await Student.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!updatedStudent) {
      // If not found, create new student (in case of fallback ID)
      console.log("🔄 Creating new student record for:", id);
      const newStudent = new Student({
        ...updateData,
        name: updateData.name || "New Student",
        roll: updateData.roll || id,
      });
      updatedStudent = await newStudent.save();
      console.log("✅ New student created:", updatedStudent._id, "-", updatedStudent.name);
    } else {
      console.log("✅ Student updated:", id, "-", updatedStudent.name);
    }

    res.json(updatedStudent);
  } catch (error) {
    console.error("❌ Error updating student:", error.message);
    res.status(500).json({ error: "Error updating student", details: error.message });
  }
});

app.delete("/api/students/:id", async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: "Student deleted" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting student" });
  }
});

// 📸 Media Routes
app.get("/api/media", async (req, res) => {
  try {
    const media = await Media.find().sort({ uploadedAt: -1 });
    res.json(media);
  } catch (error) {
    res.status(500).json({ error: "Error fetching media" });
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "yearbook",
          resource_type: "auto",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      stream.end(req.file.buffer);
    });

    const newMedia = new Media({
      url: result.secure_url,
      caption: req.body.caption || "Memory",
      year: req.body.year || "Events",
      category: req.body.category || "events",
      uploadedBy: req.body.uploadedBy || "Anonymous",
    });

    await newMedia.save();
    res.json(newMedia);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Error uploading file" });
  }
});

// Alias for POST /api/media -> POST /api/upload
app.post("/api/media", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "yearbook",
          resource_type: "auto",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      stream.end(req.file.buffer);
    });

    const newMedia = new Media({
      url: result.secure_url,
      caption: req.body.caption || "Memory",
      year: req.body.year || "Events",
      category: req.body.category || "events",
      uploadedBy: req.body.uploadedBy || "Anonymous",
    });

    await newMedia.save();
    console.log("✅ Media saved to MongoDB:", newMedia._id, "- Year:", newMedia.year);
    res.json(newMedia);
  } catch (error) {
    console.error("❌ Upload error:", error.message);
    res.status(500).json({ error: "Error uploading file", details: error.message });
  }
});

// 💬 Messages Routes (Wall)
app.get("/api/messages", async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: -1 });
    // IMPORTANT: Only return content and _id - NO sender/recipient names for anonymity
    const safeMessages = messages.map(msg => ({
      _id: msg._id,
      content: msg.content,
      createdAt: msg.createdAt
    }));
    console.log(`✅ Fetched ${messages.length} anonymous messages from MongoDB`);
    res.json(safeMessages);
  } catch (error) {
    console.error("❌ Error fetching messages:", error.message);
    res.status(500).json({ error: "Error fetching messages" });
  }
});

app.post("/api/messages", async (req, res) => {
  try {
    const newMessage = new Message(req.body);
    await newMessage.save();
    console.log("✅ Anonymous message saved to MongoDB:", newMessage._id);
    console.log(`   Content: "${newMessage.content.substring(0, 50)}..."`);
    console.log(`   From: ${newMessage.fromName} | To: ${newMessage.toName}`);
    
    // Return only safe fields - NO sender/recipient names
    res.json({
      _id: newMessage._id,
      content: newMessage.content,
      createdAt: newMessage.createdAt
    });
  } catch (error) {
    console.error("❌ Error creating message:", error.message);
    res.status(500).json({ error: "Error creating message", details: error.message });
  }
});

// ✅ Health Check
app.get("/", (req, res) => {
  res.json({ 
    message: "🎓 Batch 2022-26 Yearbook API is running!",
    mongoConnected: mongoConnected,
    env: process.env.NODE_ENV
  });
});

// ✅ Database Status Check
app.get("/api/status", (req, res) => {
  res.json({
    server: "Running ✅",
    database: mongoConnected ? "Connected ✅" : "Disconnected ❌",
    cloudinary: process.env.CLOUDINARY_NAME ? "Configured ✅" : "Not Configured ❌",
  });
});

// 🧹 Reset Database (Manual cleanup endpoint)
app.post("/api/reset", async (req, res) => {
  try {
    console.log("🧹 Reset request received - clearing all data...");
    
    await Student.deleteMany({});
    await Media.deleteMany({});
    await Message.deleteMany({});
    
    console.log("✅ All collections cleared");
    
    // Reseed with 75 students
    const seedStudents = Array.from({ length: 75 }, (_, i) => ({
      name: `Classmate ${i + 1}`,
      roll: i + 1,
      image: `https://picsum.photos/seed/student${i + 1}/300/400`,
      year: ["1st yr", "2nd yr", "3rd yr", "4th yr"][i % 4],
      email: `student${i + 1}@batch26.local`,
    }));
    
    const result = await Student.insertMany(seedStudents);
    console.log(`✅ Reseeded with exactly ${result.length} students`);
    
    res.json({
      message: "✅ Database reset successful",
      students: result.length,
      media: 0,
      messages: 0,
    });
  } catch (error) {
    console.error("❌ Reset error:", error.message);
    res.status(500).json({ error: "Reset failed", details: error.message });
  }
});

// ================= START SERVER =================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 API ready at http://localhost:${PORT}/api`);
});

export default app;
