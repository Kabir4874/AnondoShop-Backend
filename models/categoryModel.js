import mongoose from "mongoose";

const slugify = (str) => {
  const base = String(str || "").trim();
  if (!base) return "";

  let slug = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u200C\u200D]/g, "") // strip zero-width joiners
    .replace(/[^a-z0-9\u0980-\u09FF\u09E6-\u09EF]+/g, "-") // keep Bangla & Latin
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) slug = `cat-${Date.now().toString(36)}`;
  return slug;
};

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
    image: { type: imageSchema, default: () => ({ url: "", publicId: "" }) },
  },
  { timestamps: true }
);

categorySchema.pre("validate", function (next) {
  if (this.isModified("name")) {
    this.slug = slugify(this.name);
  }
  // Ensure slug is never empty even if name didn't change (e.g., manual doc.set)
  if (!this.slug) {
    this.slug = slugify(this.name) || `cat-${Date.now().toString(36)}`;
  }
  next();
});

const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);

export default Category;
