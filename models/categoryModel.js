import mongoose from "mongoose";

const slugify = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-")
    .replace(/^-+|-+$/g, "");

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
  next();
});

const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);

export default Category;
