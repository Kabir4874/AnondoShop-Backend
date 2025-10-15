import Category from "../models/categoryModel.js";

const slugify = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const createCategory = async (req, res) => {
  try {
    const { name, isActive = true } = req.body || {};
    if (!name?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Category name is required" });
    }

    const slug = slugify(name);
    const exists = await Category.findOne({ $or: [{ name }, { slug }] });
    if (exists) {
      return res
        .status(400)
        .json({ success: false, message: "Category already exists" });
    }

    const category = await Category.create({
      name: name.trim(),
      slug,
      isActive,
    });

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
    const sortFields = String(sort)
      .split(",")
      .map((s) => s.trim());
    for (const sf of sortFields) {
      if (!sf) continue;
      if (sf.startsWith("-")) sortObj[sf.slice(1)] = -1;
      else sortObj[sf] = 1;
    }

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
    const { name, isActive } = req.body || {};

    const payload = {};
    if (typeof name === "string" && name.trim()) {
      payload.name = name.trim();
      payload.slug = slugify(name);
      const dup = await Category.findOne({
        _id: { $ne: id },
        $or: [{ name: payload.name }, { slug: payload.slug }],
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: "Another category with the same name already exists",
        });
      }
    }
    if (typeof isActive === "boolean") payload.isActive = isActive;

    const updated = await Category.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    return res.status(200).json({ success: true, category: updated });
  } catch (err) {
    console.error("updateCategory:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    return res.status(200).json({ success: true, message: "Category deleted" });
  } catch (err) {
    console.error("deleteCategory:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
