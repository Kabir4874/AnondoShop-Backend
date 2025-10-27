import mongoose from "mongoose";

const marketingConfigSchema = new mongoose.Schema(
  {
    // Facebook
    fbPixelId: { type: String, default: "" }, // public
    fbAccessToken: { type: String, default: "" }, // secret (server-only)
    fbTestEventCode: { type: String, default: "" }, // optional (for Events Manager Test)

    enableFacebook: { type: Boolean, default: false },

    // TikTok
    tiktokPixelId: { type: String, default: "" }, // public
    tiktokAccessToken: { type: String, default: "" }, // secret (server-only)
    enableTikTok: { type: Boolean, default: false },

    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

const MarketingConfig =
  mongoose.models.MarketingConfig ||
  mongoose.model("MarketingConfig", marketingConfigSchema);

export default MarketingConfig;
