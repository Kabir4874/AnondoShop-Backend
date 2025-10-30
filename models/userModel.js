// models/userModel.js
import mongoose from "mongoose";

// --- Utils ---
const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;

/**
 * Normalize BD phone:
 * - Strips spaces/dashes
 * - Ensures it starts with +88 (E.164-like)
 * - Stores as +8801XXXXXXXXX
 */
function normalizeBDPhone(v) {
  if (!v) return v;
  const raw = String(v).replace(/[^\d+]/g, "");
  // Already +8801XXXXXXXXX
  if (/^\+8801[3-9]\d{8}$/.test(raw)) return raw;
  // 01XXXXXXXXX or 8801XXXXXXXXX
  const digits = raw.replace(/^\+?/, "");
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  return v; // let validator handle invalids
}

const addressSchema = new mongoose.Schema(
  {
    recipientName: { type: String, trim: true, required: true },
    phone: {
      type: String,
      trim: true,
      required: true,
      validate: {
        validator: (v) => BD_PHONE_REGEX.test(v),
        message: "Invalid Bangladesh phone number",
      },
      set: normalizeBDPhone,
    },
    addressLine1: { type: String, trim: true, required: true },
    district: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // Primary identity (phone-only)
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: {
        validator: (v) => BD_PHONE_REGEX.test(v),
        message: "Invalid Bangladesh phone number",
      },
      set: normalizeBDPhone,
      index: true,
    },

    // Optional profile info
    name: { type: String, trim: true },

    // Password is optional (checkout can create account without it)
    password: { type: String, select: false },

    // Single saved address (optional)
    address: { type: addressSchema },

    // Audit fields
    passwordSetAt: { type: Date },
    lastLoginAt: { type: Date },
    createdVia: {
      type: String,
      enum: ["checkout", "register", "admin", "unknown"],
      default: "unknown",
    },
  },
  { minimize: false, timestamps: true }
);

const userModel = mongoose.models.user || mongoose.model("user", userSchema);
export default userModel;
export { BD_PHONE_REGEX, normalizeBDPhone };
