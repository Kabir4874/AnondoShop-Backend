// routes/userRouter.js
import express from "express";
import authUser from "../middleware/auth.js";

// NOTE: using the new phone-only controller
import {
  ensureAccountForCheckout,
  getUserProfile,
  loginAdmin,
  loginUser,
  registerUser,
  saveOrUpdateAddress,
  setPassword,
} from "../controllers/userController.js";

const userRouter = express.Router();

/**
 * Public auth endpoints
 */
userRouter.post("/register", registerUser); // phone + password (optional name)
userRouter.post("/login", loginUser); // phone + password
userRouter.post("/ensure-account-for-checkout", ensureAccountForCheckout); // phone (+ name/address) -> token for checkout

/**
 * Password setup after checkout-created account
 */
userRouter.post("/set-password", authUser, setPassword); // auth required

/**
 * Profile & address (auth required)
 */
userRouter.post("/address", authUser, saveOrUpdateAddress);
userRouter.get("/profile", authUser, getUserProfile);

/**
 * Admin login (env-based). Keep old /admin for backward compatibility.
 */
userRouter.post("/admin/login", loginAdmin);
userRouter.post("/admin", loginAdmin); // legacy alias

export default userRouter;
