import mongoose from "mongoose";

const headlineSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 280 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const bannerSchema = new mongoose.Schema(
  {
    image: {
      url: { type: String, required: true, trim: true, maxlength: 2000 },
      publicId: { type: String, required: true, trim: true, maxlength: 500 },
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Headline =
  mongoose.models.Headline || mongoose.model("Headline", headlineSchema);

export const Banner =
  mongoose.models.Banner || mongoose.model("Banner", bannerSchema);
