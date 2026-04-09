import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  app.use(express.json());

  // Dynamic database of allowed users
  let allowedStudents = [
    { name: "Aditya kumar", admissionNo: "257023007" },
    { name: "John Doe", admissionNo: "123456" },
    { name: "Jane Smith", admissionNo: "789012" },
    { name: "Test Student", admissionNo: "000" }
  ];

  let allowedTeachers = [
    { name: "vamshi", idCode: "vamshi018" }
  ];

  const ADMIN_SECRET = "RATANTATA";

  // Verification API
  app.post("/api/verify", (req, res) => {
    const { name, admissionNo, role, idCode } = req.body;
    const normalizedName = name?.trim().toLowerCase();

    if (role === "teacher") {
      const teacher = allowedTeachers.find(
        (t) => t.name.trim().toLowerCase() === normalizedName && t.idCode.trim() === idCode?.trim()
      );
      if (teacher) {
        return res.json({ success: true, role: "teacher", displayName: teacher.name.trim() });
      } else {
        return res.status(401).json({ success: false, message: "Invalid Teacher Credentials" });
      }
    }

    const student = allowedStudents.find(
      (s) => s.name.trim().toLowerCase() === normalizedName && s.admissionNo.trim() === admissionNo?.trim()
    );

    if (student) {
      // Format: admissionNumber_Name
      const displayName = `${student.admissionNo.trim()}_${student.name.trim()}`;
      res.json({ success: true, role: "student", displayName });
    } else {
      res.status(401).json({ success: false, message: "Invalid Admission Details" });
    }
  });

  // Add Student API (Bulk)
  app.post("/api/add-student", (req, res) => {
    const { students, adminCode } = req.body;

    if (adminCode !== ADMIN_SECRET) {
      return res.status(403).json({ success: false, message: "Unauthorized: Invalid Admin Code" });
    }

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: "A list of students is required" });
    }

    let addedCount = 0;
    students.forEach(s => {
      const name = s.name?.trim();
      const admissionNo = s.admissionNo?.trim();
      
      if (name && admissionNo) {
        const exists = allowedStudents.find(existing => existing.admissionNo === admissionNo);
        if (!exists) {
          allowedStudents.push({ name, admissionNo });
          addedCount++;
        }
      }
    });

    res.json({ success: true, message: `${addedCount} student(s) added successfully!` });
  });

  // Add Teacher API (Bulk)
  app.post("/api/add-teacher", (req, res) => {
    const { teachers, adminCode } = req.body;

    if (adminCode !== ADMIN_SECRET) {
      return res.status(403).json({ success: false, message: "Unauthorized: Invalid Admin Code" });
    }

    if (!Array.isArray(teachers) || teachers.length === 0) {
      return res.status(400).json({ success: false, message: "A list of teachers is required" });
    }

    let addedCount = 0;
    teachers.forEach(t => {
      const name = t.name?.trim();
      const idCode = t.idCode?.trim();
      
      if (name && idCode) {
        const exists = allowedTeachers.find(existing => existing.idCode === idCode);
        if (!exists) {
          allowedTeachers.push({ name, idCode });
          addedCount++;
        }
      }
    });

    res.json({ success: true, message: `${addedCount} teacher(s) added successfully!` });
  });

  // Socket.IO Logic
  const users = new Map();
  const polls = new Map();

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", ({ name, role, isMicOn, isCamOn }) => {
      users.set(socket.id, { id: socket.id, name, role, isMicOn, isCamOn, handRaised: false });
      
      // Broadcast updated user list
      const userList = Array.from(users.values());
      io.emit("users", userList);
      
      // Send active polls to the new user
      socket.emit("all-polls", Array.from(polls.values()));
      
      // Tell the new user who is already in the room
      socket.emit("all-users", userList.filter(u => u.id !== socket.id));

      // Notify others
      socket.broadcast.emit("message", {
        id: Date.now().toString(),
        sender: "System",
        text: `${name} (${role}) has joined the class.`,
        timestamp: new Date().toLocaleTimeString(),
        type: "system"
      });
    });

    // WebRTC Signaling
    socket.on("sending-signal", payload => {
      io.to(payload.userToSignal).emit('user-joined', { signal: payload.signal, callerID: payload.callerID, name: payload.name, role: payload.role });
    });

    socket.on("returning-signal", payload => {
      io.to(payload.callerID).emit('receiving-returned-signal', { signal: payload.signal, id: socket.id });
    });

    socket.on("toggle-hand", (isRaised) => {
      const user = users.get(socket.id);
      if (user) {
        user.handRaised = isRaised;
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("toggle-mic", (isOn) => {
      const user = users.get(socket.id);
      if (user) {
        user.isMicOn = isOn;
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("toggle-cam", (isOn) => {
      const user = users.get(socket.id);
      if (user) {
        user.isCamOn = isOn;
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("speaking-status", (isSpeaking) => {
      const user = users.get(socket.id);
      if (user) {
        user.isSpeaking = isSpeaking;
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("screen-share-started", () => {
      const user = users.get(socket.id);
      if (user) {
        user.isScreenSharing = true;
        user.isScreenPaused = false;
        io.emit("presenter-changed", socket.id);
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("toggle-screen-pause", (isPaused) => {
      const user = users.get(socket.id);
      if (user && user.isScreenSharing) {
        user.isScreenPaused = isPaused;
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("screen-share-stopped", () => {
      const user = users.get(socket.id);
      if (user) {
        user.isScreenSharing = false;
        io.emit("presenter-changed", null);
        io.emit("users", Array.from(users.values()));
      }
    });

    socket.on("kick-student", (studentId) => {
      const teacher = users.get(socket.id);
      if (teacher && teacher.role === "teacher") {
        io.to(studentId).emit("kicked");
      }
    });

    socket.on("create-poll", (pollData) => {
      const user = users.get(socket.id);
      if (user && user.role === "teacher") {
        const pollId = Date.now().toString();
        const newPoll = {
          id: pollId,
          question: pollData.question,
          options: pollData.options.map((opt: string) => ({ text: opt, votes: [] })),
          creatorName: user.name,
          isActive: true,
          timestamp: new Date().toLocaleTimeString()
        };
        polls.set(pollId, newPoll);
        io.emit("poll-created", newPoll);
      }
    });

    socket.on("vote-poll", ({ pollId, optionIndex }) => {
      const poll = polls.get(pollId);
      if (poll && poll.isActive) {
        // Remove previous vote if exists
        poll.options.forEach((opt: any) => {
          opt.votes = opt.votes.filter((v: string) => v !== socket.id);
        });
        // Add new vote
        poll.options[optionIndex].votes.push(socket.id);
        io.emit("poll-updated", poll);
      }
    });

    socket.on("end-poll", (pollId) => {
      const user = users.get(socket.id);
      const poll = polls.get(pollId);
      if (user && user.role === "teacher" && poll) {
        poll.isActive = false;
        io.emit("poll-updated", poll);
      }
    });

    socket.on("send-message", (message) => {
      // Basic moderation: block long messages
      if (message.text.length > 500) {
        socket.emit("message", {
          id: Date.now().toString(),
          sender: "System",
          text: "Message too long. Please keep it under 500 characters.",
          timestamp: new Date().toLocaleTimeString(),
          type: "system"
        });
        return;
      }

      const user = users.get(socket.id);
      if (user) {
        const msg = {
          id: Date.now().toString(),
          sender: user.name,
          role: user.role,
          text: message.text,
          timestamp: new Date().toLocaleTimeString(),
          type: "user"
        };
        io.emit("message", msg);
      }
    });

    socket.on("disconnect", () => {
      const user = users.get(socket.id);
      if (user) {
        if (user.isScreenSharing) {
          io.emit("presenter-changed", null);
        }
        socket.broadcast.emit("message", {
          id: Date.now().toString(),
          sender: "System",
          text: `${user.name} has left the class.`,
          timestamp: new Date().toLocaleTimeString(),
          type: "system"
        });
        users.delete(socket.id);
        io.emit("users", Array.from(users.values()));
      }
      console.log("User disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
