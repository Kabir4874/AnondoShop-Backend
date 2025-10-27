import MarketingConfig from "../models/marketingConfigModel.js";

export const getPublicMarketingConfig = async (_req, res) => {
  try {
    const cfg =
      (await MarketingConfig.findOne().lean()) ||
      (await MarketingConfig.create({})).toObject();

    return res.json({
      success: true,
      config: {
        enableFacebook: !!cfg.enableFacebook,
        fbPixelId: cfg.fbPixelId || "",
        fbTestEventCode: cfg.fbTestEventCode || "",

        enableTikTok: !!cfg.enableTikTok,
        tiktokPixelId: cfg.tiktokPixelId || "",
      },
    });
  } catch (err) {
    console.error("getPublicMarketingConfig:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const upsertMarketingConfig = async (req, res) => {
  try {
    const {
      enableFacebook,
      fbPixelId,
      fbAccessToken,
      fbTestEventCode,

      enableTikTok,
      tiktokPixelId,
      tiktokAccessToken,
    } = req.body || {};

    let cfg = await MarketingConfig.findOne();
    if (!cfg) cfg = new MarketingConfig({});

    if (typeof enableFacebook === "boolean")
      cfg.enableFacebook = enableFacebook;
    if (typeof fbPixelId === "string") cfg.fbPixelId = fbPixelId.trim();
    if (typeof fbAccessToken === "string")
      cfg.fbAccessToken = fbAccessToken.trim();
    if (typeof fbTestEventCode === "string")
      cfg.fbTestEventCode = fbTestEventCode.trim();

    if (typeof enableTikTok === "boolean") cfg.enableTikTok = enableTikTok;
    if (typeof tiktokPixelId === "string")
      cfg.tiktokPixelId = tiktokPixelId.trim();
    if (typeof tiktokAccessToken === "string")
      cfg.tiktokAccessToken = tiktokAccessToken.trim();

    cfg.updatedBy = req?.adminEmail || "admin";
    await cfg.save();

    return res.json({ success: true, message: "Marketing config saved" });
  } catch (err) {
    console.error("upsertMarketingConfig:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
