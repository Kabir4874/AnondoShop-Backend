// routes/categoryRoutes.js
import express from "express";
import multer from "multer";
import {
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from "../controllers/categoryController.js";
import adminAuth from "../middleware/adminAuth.js";

// Multer memory storage with limits + image-only filter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (jpg, png, webp, gif) are allowed"));
    }
  },
});

const router = express.Router();

// Public reads
router.get("/", listCategories);
router.get("/:id", getCategoryById);

// Admin writes (multipart)
router.post("/", adminAuth, upload.single("image"), createCategory);
router.put("/:id", adminAuth, upload.single("image"), updateCategory);
router.delete("/:id", adminAuth, deleteCategory);

export default router;
