import express from "express";
import multer from "multer";
import {
  createBanner,
  createHeadline,
  deleteBanner,
  deleteHeadline,
  // Banners
  listBanners,
  // Headlines
  listHeadlines,
  updateBanner,
  updateHeadline,
} from "../controllers/contentController.js";
import adminAuth from "../middleware/adminAuth.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

/* ---------------------- Headlines (text only) ---------------------- */
// Public
router.get("/headlines", listHeadlines);

// Admin
router.post("/headlines", adminAuth, createHeadline);
router.put("/headlines/:id", adminAuth, updateHeadline);
router.delete("/headlines/:id", adminAuth, deleteHeadline);

/* ----------------------- Banners (image only) ---------------------- */
// Public
router.get("/banners", listBanners);

// Admin — single image in field "image"
router.post("/banners", adminAuth, upload.single("image"), createBanner);
router.put("/banners/:id", adminAuth, upload.single("image"), updateBanner);
router.delete("/banners/:id", adminAuth, deleteBanner);

export default router;
