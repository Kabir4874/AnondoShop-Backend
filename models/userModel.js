import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    recipientName: { type: String, trim: true, required: true },
    phone: {
      type: String,
      trim: true,
      required: true,
      validate: {
        validator: (v) => /^(?:\+?88)?01[3-9]\d{8}$/.test(v),
        message: "Invalid Bangladesh phone number",
      },
    },
    addressLine1: { type: String, trim: true, required: true },
    district: { type: String, trim: true, required: true },
    postalCode: {
      type: String,
      trim: true,
      required: true,
      validate: {
        validator: (v) => /^\d{4}$/.test(v),
        message: "Postal code must be a 4-digit Bangladesh postcode",
      },
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: { type: String, required: true },
    cartData: { type: Object, default: {} },
    address: {
      type: addressSchema,
    },
  },
  { minimize: false }
);

const userModel = mongoose.models.user || mongoose.model("user", userSchema);
export default userModel;
