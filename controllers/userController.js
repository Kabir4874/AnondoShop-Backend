// controllers/authController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import userModel, {
  BD_PHONE_REGEX,
  normalizeBDPhone,
} from "../models/userModel.js";

// === Helpers ===
const createToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

/** Upserts the user's name/address onto the doc (in-place) */
function applyProfileFields(user, { name, address }) {
  if (name) user.name = name;
  if (address && typeof address === "object") {
    const { recipientName, phone, addressLine1, district, postalCode } =
      address;
    // Only set if all required address fields present
    if (recipientName && phone && addressLine1 && district && postalCode) {
      user.address = {
        recipientName,
        phone,
        addressLine1,
        district,
        postalCode,
      };
    }
  }
}

// === Auth (Phone-based) ===

/**
 * POST /api/auth/login
 * body: { phone, password }
 * Note: user must have set a password; otherwise instruct to set it.
 */
const loginUser = async (req, res) => {
  try {
    let { phone, password } = req.body || {};
    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    phone = normalizeBDPhone(phone);
    if (!BD_PHONE_REGEX.test(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Bangladesh phone number" });
    }

    const user = await userModel.findOne({ phone }).select("+password");
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid phone or password" });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        message:
          "Password not set for this number. Please set a password to log in.",
        code: "PASSWORD_NOT_SET",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid phone or password" });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = createToken(user._id);
    return res.status(200).json({ success: true, token });
  } catch (error) {
    console.error("Error while logging in user:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/auth/register
 * body: { phone, password, name? }
 *
 * For explicit registrations (e.g., from a "Create Account" screen).
 * - Requires phone + password.
 * - If user exists with no password, sets it.
 * - If user exists with password, errors.
 * - If user doesn't exist, creates user with password.
 */
const registerUser = async (req, res) => {
  try {
    let { phone, password, name } = req.body || {};
    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    phone = normalizeBDPhone(phone);
    if (!BD_PHONE_REGEX.test(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Bangladesh phone number" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    let user = await userModel.findOne({ phone }).select("+password");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    if (user) {
      if (user.password) {
        return res
          .status(400)
          .json({ success: false, message: "User already exists" });
      }
      // Set password for previously password-less account
      user.password = hashedPassword;
      user.passwordSetAt = new Date();
      if (name) user.name = name;
      await user.save();

      const token = createToken(user._id);
      return res.status(200).json({ success: true, token });
    }

    // Create fresh user
    user = await userModel.create({
      phone,
      name,
      password: hashedPassword,
      passwordSetAt: new Date(),
      createdVia: "register",
    });

    const token = createToken(user._id);
    return res.status(200).json({ success: true, token });
  } catch (error) {
    console.error("Error while registering user:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/auth/ensure-account-for-checkout
 * body: {
 *   phone, name?,
 *   address?: { recipientName, phone, addressLine1, district, postalCode }
 * }
 *
 * Behavior:
 * - If a user with the phone exists, ensure profile/address are present/updated and return a token.
 * - If not, create a user **without password** (createdVia: 'checkout') and return a token.
 * This allows placing an order while letting the user set their password later.
 */
const ensureAccountForCheckout = async (req, res) => {
  try {
    let { phone, name, address } = req.body || {};
    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone is required" });
    }

    phone = normalizeBDPhone(phone);
    if (!BD_PHONE_REGEX.test(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Bangladesh phone number" });
    }

    let user = await userModel.findOne({ phone }).select("+password");
    if (!user) {
      user = new userModel({ phone, createdVia: "checkout" });
    }

    applyProfileFields(user, { name, address });

    await user.save();

    const token = createToken(user._id);
    return res.status(200).json({
      success: true,
      message: "Account ensured for checkout",
      token,
      passwordSet: Boolean(user.password),
    });
  } catch (error) {
    console.error("Error ensuring account for checkout:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/auth/set-password
 * header: Authorization: Bearer <token>
 * body: { password }
 *
 * Sets/updates the password for the authenticated user.
 * Useful after placing an order with a phone-only account.
 */
const setPassword = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { password } = req.body || {};
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const user = await userModel.findById(userId).select("+password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.passwordSetAt = new Date();

    await user.save();

    return res
      .status(200)
      .json({ success: true, message: "Password set successfully" });
  } catch (error) {
    console.error("Error setting password:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// === Profile & Address ===

/**
 * POST /api/user/save-address
 * header: Authorization: Bearer <token>
 * body: { recipientName, phone, addressLine1, district, postalCode }
 */
const saveOrUpdateAddress = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { recipientName, phone, addressLine1, district, postalCode } =
      req.body || {};
    if (!recipientName || !phone || !addressLine1 || !district || !postalCode) {
      return res.status(400).json({
        success: false,
        message:
          "recipientName, phone, addressLine1, district and postalCode are required",
      });
    }

    const address = {
      recipientName,
      phone,
      addressLine1,
      district,
      postalCode,
    };

    const updatedUser = await userModel.findByIdAndUpdate(
      userId,
      { address },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Address saved successfully",
      address: updatedUser.address,
    });
  } catch (error) {
    console.error("Error saving/updating address:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/user/profile
 * Uses req.userId (from auth middleware). Fallback to body.userId for compatibility.
 */
const getUserProfile = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: No user ID found" });
    }

    const user = await userModel
      .findById(userId)
      .select(
        "name phone address createdVia passwordSetAt lastLoginAt createdAt updatedAt"
      )
      .lean();

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load user profile",
    });
  }
};

// === Admin Login (env-based) ===

/**
 * POST /api/auth/admin/login
 * body: { email, password }
 * Uses env ADMIN_EMAIL / ADMIN_PASSWORD
 */
const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign(email + password, process.env.JWT_SECRET, {
        expiresIn: "30d",
      });
      res.status(200).json({ success: true, token });
    } else {
      res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }
  } catch (error) {
    console.log("Error while logging in admin: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export {
  ensureAccountForCheckout,
  getUserProfile,
  loginAdmin,
  loginUser,
  registerUser,
  saveOrUpdateAddress,
  setPassword,
};
