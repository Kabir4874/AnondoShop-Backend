import express from "express";
import {
  getUserProfile,
  loginAdmin,
  loginUser,
  registerUser,
  saveOrUpdateAddress,
} from "../controllers/userController.js";
import authUser from "../middleware/auth.js";

const userRouter = express.Router();

userRouter.post("/register", registerUser);
userRouter.post("/login", loginUser);
userRouter.post("/admin", loginAdmin);
userRouter.post("/address", authUser, saveOrUpdateAddress);
userRouter.get("/profile", authUser, getUserProfile);

export default userRouter;
