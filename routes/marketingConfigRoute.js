import express from "express";
import {
  getPublicMarketingConfig,
  upsertMarketingConfig,
} from "../controllers/marketingConfigController.js";
import adminAuth from "../middleware/adminAuth.js";

const router = express.Router();

router.get("/public", getPublicMarketingConfig);

router.put("/", adminAuth, upsertMarketingConfig);

export default router;
