import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import { body, validationResult } from "express-validator";

dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // Get MongoDB URI from .env

// Middleware
app.use(express.json());
app.use(cors()); // Allow frontend to access backend
app.use(morgan("dev")); // Log requests to console

// MongoDB Atlas connection
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Updated Donor Schema with detailed location
const donorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  number: { type: String, required: true },
  bloodType: { type: String, required: true },
  location: {
    state: { type: String, required: true },
    district: { type: String, required: true },
    city: { type: String, required: true } // City/Town/Village
  }
});

const Donor = mongoose.model("Donor", donorSchema);

// In-memory OTP store (use Redis or database in production)
const otpStore = new Map();
const OTP_EXPIRY = 5 * 60 * 1000; // 5 minutes expiry

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Mock SMS sending function (replace with actual SMS service)
function sendOTPSMS(number, otp) {
  console.log(`Mock SMS: Sending OTP ${otp} to ${number}`);
  // For real SMS, integrate with Twilio or another SMS service
  /*
  const twilio = require('twilio');
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    body: `Your OTP for blood donation registration is: ${otp}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: number
  });
  */
  return Promise.resolve(true); // Mock success response
}

// Route to check if donor with mobile number exists
app.get("/donors/check/:number", async (req, res) => {
  try {
    const existingDonor = await Donor.findOne({ number: req.params.number });
    res.json({ exists: !!existingDonor });
  } catch (error) {
    console.error("Error checking donor:", error);
    res.status(500).json({ error: "Error checking donor" });
  }
});

// Route to request OTP
app.post(
  "/otp/request",
  [
    body("number")
      .isMobilePhone("any")
      .withMessage("Invalid phone number")
      .matches(/^[0-9]{10}$/)
      .withMessage("Phone number must be 10 digits")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { number } = req.body;

    try {
      // Check if donor already exists
      const existingDonor = await Donor.findOne({ number });
      if (existingDonor) {
        return res.status(400).json({ success: false, message: "Donor with this number already exists" });
      }

      // Generate and store OTP
      const otp = generateOTP();
      otpStore.set(number, { otp, expires: Date.now() + OTP_EXPIRY });

      // Send OTP via SMS
      await sendOTPSMS(number, otp);

      res.json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
      console.error("Error requesting OTP:", error);
      res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
  }
);

// Route to verify OTP
app.post(
  "/otp/verify",
  [
    body("number")
      .isMobilePhone("any")
      .withMessage("Invalid phone number")
      .matches(/^[0-9]{10}$/)
      .withMessage("Phone number must be 10 digits"),
    body("otp")
      .matches(/^[0-9]{6}$/)
      .withMessage("OTP must be a 6-digit number")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { number, otp } = req.body;

    try {
      const storedOTP = otpStore.get(number);
      if (!storedOTP) {
        return res.status(400).json({ verified: false, message: "No OTP found for this number" });
      }

      if (storedOTP.expires < Date.now()) {
        otpStore.delete(number);
        return res.status(400).json({ verified: false, message: "OTP has expired" });
      }

      if (storedOTP.otp !== otp) {
        return res.status(400).json({ verified: false, message: "Invalid OTP" });
      }

      // OTP is valid, remove from store
      otpStore.delete(number);
      res.json({ verified: true, message: "OTP verified successfully" });
    } catch (error) {
      console.error("Error verifying OTP:", error);
      res.status(500).json({ verified: false, message: "Error verifying OTP" });
    }
  }
);

// Route to add a new donor with validation
app.post(
  "/donors",
  [
    body("name").isString().notEmpty().withMessage("Name is required"),
    body("age").isInt({ min: 18 }).withMessage("Age must be 18 or above"),
    body("number")
      .isMobilePhone("any")
      .withMessage("Invalid phone number")
      .matches(/^[0-9]{10}$/)
      .withMessage("Phone number must be 10 digits"),
    body("bloodType")
      .isIn(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"])
      .withMessage("Invalid blood type"),
    body("location.state").notEmpty().withMessage("State is required"),
    body("location.district").notEmpty().withMessage("District is required"),
    body("location.city").notEmpty().withMessage("City/Town/Village is required")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const newDonor = new Donor(req.body);
      await newDonor.save();
      res.status(201).json({ message: "Donor added successfully!", newDonor });
    } catch (error) {
      console.error("Error saving donor:", error);
      res.status(500).json({ error: "Error saving donor" });
    }
  }
);

// Route to get all donors
app.get("/donors", async (req, res) => {
  try {
    const donors = await Donor.find();
    res.json(donors);
  } catch (error) {
    console.error("Error fetching donors:", error);
    res.status(500).json({ error: "Error fetching donors" });
  }
});

// Route to delete a donor
app.delete("/donors/:id", async (req, res) => {
  try {
    const donor = await Donor.findByIdAndDelete(req.params.id);
    if (!donor) {
      return res.status(404).json({ error: "Donor not found" });
    }
    res.json({ message: "Donor deleted successfully" });
  } catch (error) {
    console.error("Error deleting donor:", error);
    res.status(500).json({ error: "Error deleting donor" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});