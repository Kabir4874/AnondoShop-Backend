import express from "express";
import { trackServerEvent } from "../controllers/analyticsController.js";

const router = express.Router();

router.post("/track", trackServerEvent);

export default router;
