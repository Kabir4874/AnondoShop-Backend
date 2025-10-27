// controllers/categoryController.js
import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import Category from "../models/categoryModel.js";

/* ----------------- helpers ----------------- */
const slugify = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Optimize the image in memory with sharp, then upload to Cloudinary.
 * - Auto rotate (EXIF)
 * - Max width 1600 (no enlarge)
 * - JPEG 82 quality
 */
const uploadBufferToCloudinary = async (file) => {
  // Defensive: ensure buffer exists
  if (!file?.buffer || !file?.mimetype) {
    throw new Error("Invalid image file");
  }

  // Optimize with sharp
  const optimized = await sharp(file.buffer)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  // Upload via stream (handles large buffers)
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "categories", // optional folder
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(optimized);
  });
};

/* ----------------- controllers ----------------- */
export const createCategory = async (req, res) => {
  try {
    // Multer (memoryStorage) parses multipart -> fields in req.body, file in req.file
    const nameRaw = req.body?.name;
    const isActiveRaw = req.body?.isActive;

    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Category name is required" });
    }

    const isActive =
      typeof isActiveRaw === "string"
        ? isActiveRaw === "true"
        : Boolean(isActiveRaw);

    const slug = slugify(name);
    const exists = await Category.findOne({ $or: [{ name }, { slug }] });
    if (exists) {
      return res
        .status(400)
        .json({ success: false, message: "Category already exists" });
    }

    let image = { url: "", publicId: "" };

    // If image present, compress & upload
    if (req.file && req.file.buffer) {
      try {
        image = await uploadBufferToCloudinary(req.file);
      } catch (err) {
        // Convert Cloudinary timeout into a clear response
        if (err?.http_code === 499 || err?.name === "TimeoutError") {
          return res.status(504).json({
            success: false,
            message:
              "Image upload timed out. Please try a smaller image (max 5MB) or try again.",
          });
        }
        return res.status(502).json({
          success: false,
          message:
            err?.message || "Image upload failed. Please try again later.",
        });
      }
    }

    const category = await Category.create({ name, slug, isActive, image });
    return res.status(201).json({ success: true, category });
  } catch (err) {
    console.error("createCategory:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const listCategories = async (req, res) => {
  try {
    const {
      active,
      search = "",
      page = 1,
      limit = 100,
      sort = "name",
    } = req.query;

    const q = {};
    if (active === "true") q.isActive = true;
    if (active === "false") q.isActive = false;
    if (search) {
      q.$or = [
        { name: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));

    const sortObj = {};
    String(sort)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((sf) => {
        if (sf.startsWith("-")) sortObj[sf.slice(1)] = -1;
        else sortObj[sf] = 1;
      });

    const [items, total] = await Promise.all([
      Category.find(q)
        .sort(sortObj)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Category.countDocuments(q),
    ]);

    return res.status(200).json({
      success: true,
      categories: items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    console.error("listCategories:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id).lean();
    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }
    return res.status(200).json({ success: true, category });
  } catch (err) {
    console.error("getCategoryById:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const nameRaw = req.body?.name;
    const isActiveRaw = req.body?.isActive;

    const payload = {};

    if (typeof nameRaw === "string" && nameRaw.trim()) {
      const name = nameRaw.trim();
      const slug = slugify(name);
      const dup = await Category.findOne({
        _id: { $ne: id },
        $or: [{ name }, { slug }],
      });
      if (dup) {
        return res
          .status(400)
          .json({ success: false, message: "Category already exists" });
      }
      payload.name = name;
      payload.slug = slug;
    }

    if (typeof isActiveRaw !== "undefined") {
      payload.isActive =
        typeof isActiveRaw === "string"
          ? isActiveRaw === "true"
          : Boolean(isActiveRaw);
    }

    const category = await Category.findById(id);
    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    // Replace image if a new file is given
    if (req.file && req.file.buffer) {
      try {
        if (category.image?.publicId) {
          try {
            await cloudinary.uploader.destroy(category.image.publicId);
          } catch {
            /* ignore cloudinary destroy errors */
          }
        }
        const newImage = await uploadBufferToCloudinary(req.file);
        payload.image = newImage;
      } catch (err) {
        if (err?.http_code === 499 || err?.name === "TimeoutError") {
          return res.status(504).json({
            success: false,
            message:
              "Image upload timed out. Please try a smaller image (max 5MB) or try again.",
          });
        }
        return res.status(502).json({
          success: false,
          message:
            err?.message || "Image upload failed. Please try again later.",
        });
      }
    }

    const updated = await Category.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    return res.status(200).json({ success: true, category: updated });
  } catch (err) {
    console.error("updateCategory:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    if (category.image?.publicId) {
      try {
        await cloudinary.uploader.destroy(category.image.publicId);
      } catch {
        /* ignore destroy error */
      }
    }

    await Category.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: "Category deleted" });
  } catch (err) {
    console.error("deleteCategory:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
