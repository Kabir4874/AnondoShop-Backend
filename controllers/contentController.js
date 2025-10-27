import { v2 as cloudinary } from "cloudinary";
import { Banner, Headline } from "../models/contentModels.js";

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

// PUT /api/content/headlines/:id (admin)
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
    const file = req.file;
    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "image file is required" });
    }

    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
    });

    const { isActive = true } = req.body || {};

    const b = await Banner.create({
      image: { url: result.secure_url, publicId: result.public_id },
      isActive: !!isActive,
    });

    res.status(201).json({ success: true, banner: b });
  } catch (err) {
    console.error("createBanner:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);
    if (!banner)
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });

    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        resource_type: "image",
      });
      if (banner.image?.publicId) {
        try {
          await cloudinary.uploader.destroy(banner.image.publicId);
        } catch {}
      }
      banner.image = { url: uploaded.secure_url, publicId: uploaded.public_id };
    }

    if ("isActive" in req.body) banner.isActive = !!req.body.isActive;

    await banner.save();
    res.json({ success: true, banner });
  } catch (err) {
    console.error("updateBanner:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);
    if (!banner)
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });

    if (banner.image?.publicId) {
      try {
        await cloudinary.uploader.destroy(banner.image.publicId);
      } catch {}
    }
    await Banner.findByIdAndDelete(id);

    res.json({ success: true, message: "Banner deleted" });
  } catch (err) {
    console.error("deleteBanner:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
