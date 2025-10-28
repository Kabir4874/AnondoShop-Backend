// routes/contentRoutes.js
import express from "express";
import multer from "multer";
import {
  createBanner,
  createHeadline,
  deleteBanner,
  deleteHeadline,
  listBanners,
  listHeadlines,
  updateBanner,
  updateHeadline,
} from "../controllers/contentController.js";
import adminAuth from "../middleware/adminAuth.js";

const router = express.Router();

// Multer memory storage configuration for Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (jpg, png, webp, gif) are allowed"));
    }
  },
});

// Multer error handling middleware
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large. Maximum size is 5MB.",
      });
    }
  } else if (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
  next();
};

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
router.post(
  "/banners",
  adminAuth,
  upload.single("image"),
  handleMulterError,
  createBanner
);

router.put(
  "/banners/:id",
  adminAuth,
  upload.single("image"),
  handleMulterError,
  updateBanner
);

router.delete("/banners/:id", adminAuth, deleteBanner);

export default router;
