import axios from "axios";
import crypto from "crypto";
import MarketingConfig from "../models/marketingConfigModel.js";

const sha256 = (val) =>
  val
    ? crypto
        .createHash("sha256")
        .update(String(val).trim().toLowerCase())
        .digest("hex")
    : undefined;

async function sendFacebookEvent({
  pixelId,
  accessToken,
  testEventCode,
  event,
}) {
  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;
  const payload = {
    data: [event],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
  const { data } = await axios.post(url, payload, { timeout: 15000 });
  return data;
}

async function sendTikTokEvent({ accessToken, event }) {
  const url = "https://business-api.tiktok.com/open_api/v1.3/pixel/track/";
  const payload = {
    pixel_code: event.pixel_code, // set below
    event: event.event_name,
    event_id: event.event_id,
    timestamp: event.timestamp,
    context: event.context,
    properties: event.properties || {},
  };

  const { data } = await axios.post(url, payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Token": accessToken,
    },
    timeout: 15000,
  });
  return data;
}

export const trackServerEvent = async (req, res) => {
  try {
    const {
      provider = "both",
      eventName = "PageView",
      eventId,
      phone,
      value,
      currency = "BDT",
      content_ids = [],
      content_name = "",
      userAgent,
      ip,
    } = req.body || {};

    const cfg = await MarketingConfig.findOne().lean();
    if (!cfg) {
      return res
        .status(500)
        .json({ success: false, message: "Marketing config missing" });
    }

    const ipAddr =
      ip ||
      req.headers["x-forwarded-for"]?.split(",")?.[0] ||
      req.socket?.remoteAddress ||
      "";
    const ua = userAgent || req.headers["user-agent"] || "";

    const result = { facebook: null, tiktok: null };

    if (
      cfg.enableFacebook &&
      cfg.fbPixelId &&
      cfg.fbAccessToken &&
      (provider === "facebook" || provider === "both")
    ) {
      const fbEvent = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        user_data: {
          ph: phone ? [sha256(phone)] : undefined,
          client_ip_address: ipAddr,
          client_user_agent: ua,
          fbp: req.cookies?._fbp,
          fbc: req.cookies?._fbc,
        },
        custom_data: {
          currency,
          value: typeof value === "number" ? value : undefined,
          content_ids: Array.isArray(content_ids) ? content_ids : undefined,
          content_name: content_name || undefined,
        },
        action_source: "website",
      };

      try {
        result.facebook = await sendFacebookEvent({
          pixelId: cfg.fbPixelId,
          accessToken: cfg.fbAccessToken,
          testEventCode: cfg.fbTestEventCode,
          event: fbEvent,
        });
      } catch (e) {
        result.facebook = { error: e?.response?.data || e.message };
      }
    }

    if (
      cfg.enableTikTok &&
      cfg.tiktokPixelId &&
      cfg.tiktokAccessToken &&
      (provider === "tiktok" || provider === "both")
    ) {
      const hashedPhone = phone ? sha256(phone) : undefined;

      const tkEvent = {
        pixel_code: cfg.tiktokPixelId,
        event_name: eventName,
        event_id: eventId,
        timestamp: Math.floor(Date.now() / 1000),
        context: {
          page: { url: req.headers?.referer || "" },
          user: {
            external_id: hashedPhone,
            phone_number: hashedPhone,
            ip: ipAddr,
            user_agent: ua,
          },
        },
        properties: {
          value: typeof value === "number" ? value : undefined,
          currency,
          contents: Array.isArray(content_ids)
            ? content_ids.map((id) => ({ content_id: id, quantity: 1 }))
            : [],
        },
      };

      try {
        result.tiktok = await sendTikTokEvent({
          accessToken: cfg.tiktokAccessToken,
          event: tkEvent,
        });
      } catch (e) {
        result.tiktok = { error: e?.response?.data || e.message };
      }
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error("trackServerEvent:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
