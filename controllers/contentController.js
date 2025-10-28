// controllers/contentController.js
import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { Banner, Headline } from "../models/contentModels.js";

// Cloudinary configuration (make sure to set these environment variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* ----------------- Utility Functions ----------------- */
function parseBool(v, def = false) {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function parsePagination({ page = 1, limit = 20, max = 100 }) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(max, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * l;
  return { page: p, limit: l, skip };
}

/**
 * Optimize and upload image buffer to Cloudinary
 */
const uploadImageToCloudinary = async (
  fileBuffer,
  mimetype,
  folder = "banners"
) => {
  try {
    if (!fileBuffer || !mimetype) {
      throw new Error("Invalid file data");
    }

    // Optimize image with sharp
    const optimizedBuffer = await sharp(fileBuffer)
      .rotate() // Auto-rotate based on EXIF
      .resize({
        width: 1200,
        height: 600,
        fit: "cover",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();

    // Upload to Cloudinary
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "image",
          folder: folder,
          quality: "auto",
          fetch_format: "auto",
        },
        (error, result) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            reject(error);
          } else {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
            });
          }
        }
      );

      uploadStream.end(optimizedBuffer);
    });
  } catch (error) {
    console.error("Image optimization/upload error:", error);
    throw error;
  }
};

/**
 * Delete image from Cloudinary
 */
const deleteImageFromCloudinary = async (publicId) => {
  if (!publicId) return;

  try {
    await cloudinary.uploader.destroy(publicId);
    console.log(`Deleted image from Cloudinary: ${publicId}`);
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    // Don't throw error for deletion failures to avoid blocking the operation
  }
};

/* ----------------- Headline Controllers ----------------- */
export const listHeadlines = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = {};
    if (parseBool(req.query.activeOnly, false)) query.isActive = true;

    const [items, total] = await Promise.all([
      Headline.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Headline.countDocuments(query),
    ]);

    res.json({
      success: true,
      headlines: items,
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
    });
  } catch (err) {
    console.error("listHeadlines:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createHeadline = async (req, res) => {
  try {
    const { text, isActive = true } = req.body || {};
    if (!text || !String(text).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "text is required" });
    }
    const h = await Headline.create({
      text: String(text).trim(),
      isActive: !!isActive,
    });
    res.status(201).json({ success: true, headline: h });
  } catch (err) {
    console.error("createHeadline:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateHeadline = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = {};
    if ("text" in req.body) payload.text = String(req.body.text || "").trim();
    if ("isActive" in req.body) payload.isActive = !!req.body.isActive;

    const updated = await Headline.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: "Headline not found" });

    res.json({ success: true, headline: updated });
  } catch (err) {
    console.error("updateHeadline:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteHeadline = async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await Headline.findByIdAndDelete(id);
    if (!removed)
      return res
        .status(404)
        .json({ success: false, message: "Headline not found" });
    res.json({ success: true, message: "Headline deleted" });
  } catch (err) {
    console.error("deleteHeadline:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ----------------- Banner Controllers ----------------- */
export const listBanners = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = {};
    if (parseBool(req.query.activeOnly, false)) query.isActive = true;

    const [items, total] = await Promise.all([
      Banner.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Banner.countDocuments(query),
    ]);

    res.json({
      success: true,
      banners: items,
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
    });
  } catch (err) {
    console.error("listBanners:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createBanner = async (req, res) => {
  try {
    // Check if file exists (from memory storage)
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Image file is required" });
    }

    // Upload to Cloudinary
    const imageData = await uploadImageToCloudinary(
      req.file.buffer,
      req.file.mimetype,
      "banners"
    );

    const isActive = parseBool(req.body?.isActive, true);

    // Create banner in database
    const banner = await Banner.create({
      image: {
        url: imageData.url,
        publicId: imageData.publicId,
      },
      isActive: isActive,
    });

    res.status(201).json({
      success: true,
      banner,
    });
  } catch (err) {
    console.error("createBanner:", err);

    // Handle specific Cloudinary errors
    if (err.http_code === 499 || err.name === "TimeoutError") {
      return res.status(504).json({
        success: false,
        message:
          "Image upload timed out. Please try a smaller image or try again.",
      });
    }

    if (err.message.includes("File size too large")) {
      return res.status(400).json({
        success: false,
        message: "Image file is too large. Maximum size is 5MB.",
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Failed to create banner",
    });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;

    // Find existing banner
    const banner = await Banner.findById(id);
    if (!banner) {
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });
    }

    const updateData = {};

    // Handle image update if new file provided
    if (req.file && req.file.buffer) {
      try {
        // Delete old image from Cloudinary
        if (banner.image?.publicId) {
          await deleteImageFromCloudinary(banner.image.publicId);
        }

        // Upload new image to Cloudinary
        const newImageData = await uploadImageToCloudinary(
          req.file.buffer,
          req.file.mimetype,
          "banners"
        );

        updateData.image = {
          url: newImageData.url,
          publicId: newImageData.publicId,
        };
      } catch (uploadError) {
        console.error("Image upload error in update:", uploadError);

        if (
          uploadError.http_code === 499 ||
          uploadError.name === "TimeoutError"
        ) {
          return res.status(504).json({
            success: false,
            message:
              "Image upload timed out. Please try a smaller image or try again.",
          });
        }

        return res.status(502).json({
          success: false,
          message: "Failed to upload new image. Please try again.",
        });
      }
    }

    // Handle isActive update
    if ("isActive" in req.body) {
      updateData.isActive = parseBool(req.body.isActive);
    }

    // Update banner
    const updatedBanner = await Banner.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      banner: updatedBanner,
    });
  } catch (err) {
    console.error("updateBanner:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to update banner",
    });
  }
};

export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;

    // Find banner first to get image data
    const banner = await Banner.findById(id);
    if (!banner) {
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });
    }

    // Delete image from Cloudinary
    if (banner.image?.publicId) {
      await deleteImageFromCloudinary(banner.image.publicId);
    }

    // Delete from database
    await Banner.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Banner deleted successfully",
    });
  } catch (err) {
    console.error("deleteBanner:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to delete banner",
    });
  }
};
