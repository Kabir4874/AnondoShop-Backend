// controllers/orderController.js
import axios from "axios";
import jwt from "jsonwebtoken";
import SSLCommerzPayment from "sslcommerz-lts";
import orderModel from "../models/orderModel.js";
import productModel from "../models/productModel.js";
import userModel from "../models/userModel.js";

// ---------- Config ----------
const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWORD;
const is_live = (process.env.SSLCZ_IS_LIVE || "false") === "true";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const COURIER_API = process.env.COURIER_API;

const BKASH_CHECKOUT_GRANT_URL = process.env.BKASH_CHECKOUT_GRANT_URL;
const BKASH_CHECKOUT_CREATE_URL = process.env.BKASH_CHECKOUT_CREATE_URL;
const BKASH_CHECKOUT_EXECUTE_URL = process.env.BKASH_CHECKOUT_EXECUTE_URL;
const BKASH_CHECKOUT_CALLBACK_URL = process.env.BKASH_CHECKOUT_CALLBACK_URL;

const BKASH_USERNAME = process.env.BKASH_USERNAME;
const BKASH_PASSWORD = process.env.BKASH_PASSWORD;
const BKASH_APP_KEY = process.env.BKASH_APP_KEY;
const BKASH_APP_SECRET = process.env.BKASH_APP_SECRET;

// ---------- Phone helpers ----------
const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;
function normalizeBDPhone(v) {
  if (!v) return v;
  const raw = String(v).replace(/[^\d+]/g, "");
  if (/^\+8801[3-9]\d{8}$/.test(raw)) return raw;
  const digits = raw.replace(/^\+?/, "");
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  return raw;
}

// ---------- Token (optional to return) ----------
const createToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

// ---------- bKash token cache ----------
let bkashHostedIdToken = null;
let bkashHostedTokenExpiry = 0;

async function bkashGrantTokenHosted() {
  const now = Date.now();
  if (bkashHostedIdToken && now < bkashHostedTokenExpiry - 30_000) {
    return bkashHostedIdToken;
  }

  if (
    !BKASH_CHECKOUT_GRANT_URL ||
    !BKASH_USERNAME ||
    !BKASH_PASSWORD ||
    !BKASH_APP_KEY ||
    !BKASH_APP_SECRET
  ) {
    throw new Error("bKash Hosted env configuration is missing");
  }

  try {
    const { data } = await axios.post(
      BKASH_CHECKOUT_GRANT_URL,
      { app_key: BKASH_APP_KEY, app_secret: BKASH_APP_SECRET },
      {
        headers: {
          "Content-Type": "application/json",
          username: BKASH_USERNAME,
          password: BKASH_PASSWORD,
        },
        timeout: 15000,
      }
    );

    if (!data?.id_token) {
      throw new Error(`bKash grant token failed: ${JSON.stringify(data)}`);
    }

    bkashHostedIdToken = data.id_token;
    const expiresIn = Number(data.expires_in || 3600);
    bkashHostedTokenExpiry = Date.now() + expiresIn * 1000;

    return bkashHostedIdToken;
  } catch (err) {
    const payload = err?.response?.data || err.message;
    throw new Error(`bKash grant token failed: ${JSON.stringify(payload)}`);
  }
}

async function bkashHostedHeaders() {
  const idToken = await bkashGrantTokenHosted();
  return {
    "Content-Type": "application/json",
    authorization: idToken,
    "x-app-key": BKASH_APP_KEY,
  };
}

// ----------------------- Helpers -----------------------
function generateTransactionId() {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rnd}`;
}

function validateBdAddress(addr) {
  if (!addr) return "Address is required";
  const { recipientName, phone, addressLine1, district } = addr;
  if (!recipientName || !phone || !addressLine1 || !district) {
    return "recipientName, phone, addressLine1, district are required";
  }
  const normalized = normalizeBDPhone(phone);
  if (!BD_PHONE_REGEX.test(String(normalized))) {
    return "Invalid Bangladesh phone number";
  }
  return null;
}

function isXXL(size) {
  if (!size) return false;
  const s = String(size).toUpperCase();
  return s.startsWith("XXL");
}

function computeDeliveryFeeFromAddress(address) {
  if (!address) return { fee: 150, label: "Other" };
  const d = String(address.district || "")
    .toLowerCase()
    .trim();
  const line = String(address.addressLine1 || "").toLowerCase();

  if (d === "dhaka") return { fee: 80, label: "Dhaka" };
  if (d === "gazipur") return { fee: 120, label: "Gazipur" };

  const isSavar = d.includes("savar") || line.includes("savar");
  const isAshulia =
    d.includes("ashulia") ||
    d.includes("asulia") ||
    line.includes("ashulia") ||
    line.includes("asulia");
  if (isSavar || isAshulia) return { fee: 120, label: "Savar/Ashulia" };

  return { fee: 150, label: "Other" };
}

/**
 * NEW: compute fee from explicit override (deliveryArea widget) if provided/valid,
 * else fall back to address-derived fee.
 */
function resolveDeliveryFee(address, deliveryOverride) {
  const area = String(deliveryOverride?.area || "").toLowerCase();
  const feeNum = Number(deliveryOverride?.fee);
  const label = deliveryOverride?.label;

  if (
    (area === "inside" || area === "outside") &&
    Number.isFinite(feeNum) &&
    feeNum >= 0
  ) {
    return {
      fee: feeNum,
      label:
        label ||
        (area === "inside" ? "Inside Dhaka City" : "Outside Dhaka City"),
      via: "override",
    };
  }
  const fb = computeDeliveryFeeFromAddress(address);
  return { ...fb, via: "address" };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const productId = it._id || it.productId || it.id;
    return {
      productId: String(productId),
      size: it.size,
      quantity: Number(it.quantity || 0),
    };
  });
}

async function computeTotalsFromDB(items, address, deliveryOverride) {
  const norm = normalizeItems(items).filter(
    (x) => x.productId && x.quantity > 0
  );
  if (norm.length === 0) throw new Error("No valid items provided");

  const productIds = [...new Set(norm.map((x) => x.productId))];
  const products = await productModel
    .find({ _id: { $in: productIds } })
    .select("_id name price discount image")
    .lean();
  const pmap = new Map(products.map((p) => [String(p._id), p]));

  let subtotal = 0;
  const lines = [];

  for (const it of norm) {
    const prod = pmap.get(it.productId);
    if (!prod) throw new Error("One or more products no longer available");

    const unitBase = Number(prod.price) || 0;
    const unitDisc = Number(prod.discount) || 0;
    const unitFinal =
      unitDisc > 0
        ? Math.max(0, unitBase - (unitBase * unitDisc) / 100)
        : unitBase;

    let lineSubtotal = unitFinal * it.quantity;
    let xxlSurchargeApplied = 0;

    if (isXXL(it.size)) {
      xxlSurchargeApplied = 50 * it.quantity;
      lineSubtotal += xxlSurchargeApplied;
    }

    subtotal += lineSubtotal;

    lines.push({
      productId: it.productId,
      name: prod.name,
      size: it.size,
      quantity: it.quantity,
      unitBase,
      unitDiscount: unitDisc,
      unitFinal,
      lineSubtotal,
      xxlSurchargeApplied,
      image: Array.isArray(prod.image) ? prod.image : [],
    });
  }

  const feeMeta = resolveDeliveryFee(address, deliveryOverride);
  const computedAmount = subtotal + feeMeta.fee;

  return {
    computedAmount,
    deliveryFee: feeMeta.fee,
    deliveryLabel: feeMeta.label,
    lines,
    feeSource: feeMeta.via,
  };
}

/** Map an order status to a progress % and step name for UI. */
function getOrderProgress(status) {
  const s = String(status || "").toLowerCase();
  const steps = [
    { key: "order placed", pct: 15 },
    { key: "paid", pct: 30 },
    { key: "processing", pct: 45 },
    { key: "shipped", pct: 70 },
    { key: "out for delivery", pct: 85 },
    { key: "delivered", pct: 100 },
    { key: "payment cancelled", pct: 0 },
    { key: "payment failed", pct: 0 },
    { key: "cancelled", pct: 0 },
  ];

  for (const st of steps) {
    if (s.includes(st.key)) {
      return { progressPct: st.pct, step: st.key };
    }
  }
  return { progressPct: 15, step: "order placed" };
}

/** Provide a simple ETA window based on area & status (best-effort). */
function estimateDeliveryWindow(address, status) {
  const { label } = computeDeliveryFeeFromAddress(address || {});
  const base =
    label === "Dhaka"
      ? [1, 3]
      : label === "Gazipur" || label === "Savar/Ashulia"
      ? [2, 4]
      : [3, 7];

  const s = String(status || "").toLowerCase();
  const tweak = s.includes("out for delivery")
    ? [0, 1]
    : s.includes("shipped")
    ? [1, 2]
    : [0, 0];

  const minDays = Math.max(1, base[0] - tweak[0]);
  const maxDays = Math.max(minDays, base[1] - tweak[1]);

  const now = new Date();
  const etaFrom = new Date(now);
  etaFrom.setDate(now.getDate() + minDays);
  const etaTo = new Date(now);
  etaTo.setDate(now.getDate() + maxDays);

  return {
    areaLabel: label,
    etaFromISO: etaFrom.toISOString(),
    etaToISO: etaTo.toISOString(),
    minDays,
    maxDays,
  };
}

/** Remove any sensitive/internal fields before returning to the user. */
function sanitizeOrderForUser(order) {
  if (!order) return null;
  const o = order.toObject ? order.toObject() : order;
  const {
    _id,
    status,
    amount,
    payment,
    paymentMethod,
    date,
    items = [],
    address = {},
    userId,
  } = o;

  const safeItems = (Array.isArray(items) ? items : []).map((it) => ({
    productId: String(it.productId || ""),
    name: it.name,
    size: it.size,
    quantity: it.quantity,
    unitBase: it.unitBase,
    unitDiscount: it.unitDiscount,
    unitFinal: it.unitFinal,
    lineSubtotal: it.lineSubtotal,
    xxlSurchargeApplied: it.xxlSurchargeApplied,
    image: it.image || [],
  }));

  const safeAddress = {
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    district: address.district,
  };

  const progress = getOrderProgress(status);
  const eta = estimateDeliveryWindow(address, status);

  return {
    orderId: String(_id),
    userId: String(userId || ""),
    status,
    progress,
    eta,
    amount,
    payment,
    paymentMethod,
    date,
    items: safeItems,
    address: safeAddress,
  };
}

// ---------- Ensure/create account by phone (for checkout) ----------
function applyProfileFields(user, { name, address }) {
  if (name) user.name = name;
  if (address && typeof address === "object") {
    const { recipientName, phone, addressLine1, district } = address;
    if (recipientName && phone && addressLine1 && district) {
      user.address = {
        recipientName,
        phone: normalizeBDPhone(phone),
        addressLine1,
        district,
      };
    }
  }
}

async function ensureAccountByPhone(phone, name, address) {
  const normalized = normalizeBDPhone(phone);
  if (!BD_PHONE_REGEX.test(normalized)) {
    const err = new Error("Invalid Bangladesh phone number");
    err.statusCode = 400;
    throw err;
  }

  let user = await userModel.findOne({ phone: normalized }).select("+password");
  if (!user) {
    user = new userModel({ phone: normalized, createdVia: "checkout" });
  }
  applyProfileFields(user, { name, address });
  await user.save();

  const token = createToken(user._id);
  const passwordSet = Boolean(user.password);
  return { user, token, passwordSet };
}

// ----------------------- COD -----------------------
const placeOrder = async (req, res) => {
  try {
    // Accept unauthenticated checkout with phone
    const { phone, name, items, address, deliveryOverride } = req.body || {};

    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "phone is required" });
    }

    // Normalize phone into address before validation/save
    if (address && address.phone) {
      address.phone = normalizeBDPhone(address.phone);
    }

    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    // Ensure account by phone
    const { user, token, passwordSet } = await ensureAccountByPhone(
      phone,
      name,
      address
    );
    const userId = user._id;

    const { computedAmount, lines, deliveryFee, deliveryLabel, feeSource } =
      await computeTotalsFromDB(items, address, deliveryOverride);

    const newOrder = await orderModel.create({
      userId,
      items: lines,
      address,
      amount: computedAmount,
      paymentMethod: "COD",
      payment: false,
      date: Date.now(),
      status: "Order Placed",
      deliveryMeta: {
        fee: deliveryFee,
        label: deliveryLabel,
        source: feeSource, // "override" | "address"
      },
    });

    return res.json({
      success: true,
      message: "Order Placed",
      orderId: newOrder._id,
      token, // allow frontend to persist session
      passwordSet,
    });
  } catch (error) {
    console.log(error);
    const code = error.statusCode || 500;
    res.status(code).json({ success: false, message: error.message });
  }
};

// ----------------------- SSLCommerz -----------------------
const initiateSslPayment = async (req, res) => {
  try {
    const { phone, name, items, address, deliveryOverride } = req.body || {};
    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "phone is required" });
    }

    if (address && address.phone) {
      address.phone = normalizeBDPhone(address.phone);
    }

    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    // Ensure account by phone
    const { user, token, passwordSet } = await ensureAccountByPhone(
      phone,
      name,
      address
    );
    const userId = user._id;

    const { computedAmount, lines, deliveryFee, deliveryLabel, feeSource } =
      await computeTotalsFromDB(items, address, deliveryOverride);

    const newOrder = await orderModel.create({
      userId,
      items: lines,
      address,
      amount: computedAmount,
      paymentMethod: "SSLCommerz",
      payment: false,
      status: "Order Placed",
      date: Date.now(),
      deliveryMeta: {
        fee: deliveryFee,
        label: deliveryLabel,
        source: feeSource,
      },
    });

    const tran_id = generateTransactionId();
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const data = {
      total_amount: computedAmount,
      currency: "BDT",
      tran_id,
      success_url: `${baseUrl}/api/order/ssl/success`,
      fail_url: `${baseUrl}/api/order/ssl/fail`,
      cancel_url: `${baseUrl}/api/order/ssl/cancel`,
      ipn_url: `${baseUrl}/api/order/ssl/ipn`,

      shipping_method: "Courier",
      product_name: "Cart Products",
      product_category: "Ecommerce",
      product_profile: "general",

      // Customer info
      cus_name: address.recipientName || "Customer",
      cus_email: "customer@example.com",
      cus_add1: address.addressLine1 || "Address Line 1",
      cus_add2: "N/A",
      cus_city: address.district || "Dhaka",
      cus_state: address.district || "Dhaka",
      cus_postcode: "1000",
      cus_country: "Bangladesh",
      cus_phone: address.phone || "01700000000",
      cus_fax: "N/A",

      // Shipping info
      ship_name: address.recipientName || "Shipping",
      ship_add1: address.addressLine1 || "Address Line 1",
      ship_add2: "N/A",
      ship_city: address.district || "Dhaka",
      ship_state: address.district || "Dhaka",
      ship_postcode: "1000",
      ship_country: "Bangladesh",

      // Pass-through values
      value_a: newOrder._id.toString(),
      value_b: userId.toString(),
    };

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const apiResponse = await sslcz.init(data);
    const GatewayPageURL = apiResponse?.GatewayPageURL;

    if (!GatewayPageURL) {
      await orderModel.findByIdAndDelete(newOrder._id);
      return res
        .status(500)
        .json({ success: false, message: "SSLCommerz init failed" });
    }

    return res.json({
      success: true,
      url: GatewayPageURL,
      orderId: newOrder._id,
      token,
      passwordSet,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const sslSuccess = async (req, res) => {
  try {
    const { value_a: orderId } = req.body || {};
    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, {
        payment: true,
        paymentMethod: "SSLCommerz",
        status: "Paid",
      });
    }
    return res.redirect(
      `${CLIENT_URL}/payment-result?status=success&orderId=${orderId || ""}`
    );
  } catch (error) {
    console.log(error);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
};

const sslFail = async (req, res) => {
  try {
    const { value_a: orderId } = req.body || {};
    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, { status: "Payment Failed" });
    }
    return res.redirect(
      `${CLIENT_URL}/payment-result?status=failed&orderId=${orderId || ""}`
    );
  } catch (error) {
    console.log(error);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
};

const sslCancel = async (req, res) => {
  try {
    const { value_a: orderId } = req.body || {};
    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, {
        status: "Payment Cancelled",
      });
    }
    return res.redirect(
      `${CLIENT_URL}/payment-result?status=cancelled&orderId=${orderId || ""}`
    );
  } catch (error) {
    console.log(error);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
};

const sslIpn = async (_req, res) => {
  try {
    // Optional: verify IPN signature if needed
    res.status(200).send("OK");
  } catch (error) {
    console.log(error);
    res.status(500).send("ERR");
  }
};

// ----------------------- bKash Hosted (Normal) Checkout -----------------------
const bkashCreatePayment = async (req, res) => {
  try {
    const { phone, name, items, address, deliveryOverride } = req.body || {};

    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "phone is required" });
    }

    if (address && address.phone) {
      address.phone = normalizeBDPhone(address.phone);
    }

    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    // Ensure account by phone
    const { user, token, passwordSet } = await ensureAccountByPhone(
      phone,
      name,
      address
    );
    const userId = user._id;

    const { computedAmount, lines, deliveryFee, deliveryLabel, feeSource } =
      await computeTotalsFromDB(items, address, deliveryOverride);

    // Create pending order
    const order = await orderModel.create({
      userId,
      items: lines,
      address,
      amount: computedAmount,
      paymentMethod: "bKash",
      payment: false,
      status: "Order Placed",
      date: Date.now(),
      deliveryMeta: {
        fee: deliveryFee,
        label: deliveryLabel,
        source: feeSource,
      },
    });

    const headers = await bkashHostedHeaders();
    const callbackURL = `${BKASH_CHECKOUT_CALLBACK_URL}?orderId=${order._id}`;

    const body = {
      amount: String(computedAmount),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: "Inv" + generateTransactionId(),
      payerReference: " ",
      callbackURL,
    };

    const { data } = await axios.post(BKASH_CHECKOUT_CREATE_URL, body, {
      headers,
      timeout: 20000,
    });

    return res
      .status(201)
      .json({ success: true, orderId: order._id, token, passwordSet, data });
  } catch (error) {
    console.error(
      "bkashCreatePayment (Hosted):",
      error?.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.message ||
        error.message ||
        "bKash Hosted create failed",
    });
  }
};

const bkashCallback = async (req, res) => {
  try {
    const { status, paymentID, orderId } = req.query || {};

    if (status !== "success" || !paymentID) {
      if (orderId) {
        await orderModel.findByIdAndUpdate(orderId, {
          status: "Payment Failed",
        });
      }
      return res.redirect(
        `${CLIENT_URL}/payment-result?status=failed${
          orderId ? `&orderId=${orderId}` : ""
        }`
      );
    }

    const headers = await bkashHostedHeaders();
    const execBody = { paymentID };

    const { data: exec } = await axios.post(
      BKASH_CHECKOUT_EXECUTE_URL,
      execBody,
      { headers, timeout: 20000 }
    );

    if (exec?.statusCode === "0000") {
      if (orderId) {
        await orderModel.findByIdAndUpdate(orderId, {
          payment: true,
          paymentMethod: "bKash",
          status: "Paid",
        });
      }
      return res.redirect(
        `${CLIENT_URL}/payment-result?status=success${
          orderId ? `&orderId=${orderId}` : ""
        }`
      );
    }

    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, { status: "Payment Failed" });
    }
    return res.redirect(
      `${CLIENT_URL}/payment-result?status=failed${
        orderId ? `&orderId=${orderId}` : ""
      }`
    );
  } catch (e) {
    console.error("bkashCallback (Hosted):", e?.response?.data || e.message);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
};

// ----------------------- Lists & Updates -----------------------
const allOrders = async (_req, res) => {
  try {
    const orders = await orderModel.find({}).sort({ date: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const userOrders = async (req, res) => {
  try {
    // still authenticated endpoint
    const userId = req.userId || req.body.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }

    const orders = await orderModel.find({ userId }).sort({ date: -1 }).lean();

    const idSet = new Set();
    for (const o of orders) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const pid = String(it.productId || it._id || it.id || "").trim();
        if (pid) idSet.add(pid);
      }
    }

    let productMap = new Map();
    if (idSet.size > 0) {
      const ids = [...idSet];
      const products = await productModel
        .find({ _id: { $in: ids } })
        .select("_id image")
        .lean();

      productMap = new Map(products.map((p) => [String(p._id), p.image]));
    }

    const ordersWithImages = orders.map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const enrichedItems = items.map((it) => {
        const pid = String(it.productId || it._id || it.id || "").trim();
        const existingImage = it.image;
        const productImage = productMap.get(pid);
        return {
          ...it,
          image: existingImage != null ? existingImage : productImage || [],
        };
      });
      return { ...o, items: enrichedItems };
    });

    return res.json({ success: true, orders: ordersWithImages });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (!orderId || !status) {
      return res
        .status(400)
        .json({ success: false, message: "orderId and status are required" });
    }
    await orderModel.findByIdAndUpdate(orderId, { status });
    res.json({ success: true, message: "Status Updated" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const updateOrderAddress = async (req, res) => {
  try {
    const { orderId, address } = req.body || {};
    if (!orderId || !address) {
      return res
        .status(400)
        .json({ success: false, message: "orderId and address are required" });
    }

    const err = validateBdAddress(address);
    if (err) {
      return res.status(400).json({ success: false, message: err });
    }

    const order = await orderModel.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    order.address = {
      recipientName: address.recipientName,
      phone: normalizeBDPhone(address.phone),
      addressLine1: address.addressLine1,
      district: address.district,
    };

    await order.save();

    return res.json({
      success: true,
      message: "Address updated successfully",
      order,
    });
  } catch (error) {
    console.error("updateOrderAddress:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

// ----------------------- Courier: Delivery Rate Check -----------------------
const courierCheck = async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "phone is required" });
    }
    if (!COURIER_API) {
      return res.status(500).json({
        success: false,
        message: "COURIER_API is not configured on the server",
      });
    }

    const response = await axios.post(
      "https://bdcourier.com/api/courier-check",
      { phone },
      {
        headers: {
          Authorization: `Bearer ${COURIER_API}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    return res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error("courierCheck:", error?.response?.data || error.message);
    const message =
      error?.response?.data?.message ||
      error?.response?.data ||
      error.message ||
      "Courier check failed";
    return res.status(502).json({ success: false, message });
  }
};

// ----------------------- Tracking -----------------------
const trackOrderMine = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { orderId } = req.params;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: "orderId is required" });
    }

    const order = await orderModel.findOne({ _id: orderId, userId });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const safe = sanitizeOrderForUser(order);
    return res.json({ success: true, order: safe });
  } catch (error) {
    console.error("trackOrderMine:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const trackOrderLookup = async (req, res) => {
  try {
    const { orderId, phone } = req.body || {};
    if (!orderId || !phone) {
      return res.status(400).json({
        success: false,
        message: "orderId and phone are required",
      });
    }

    const normPhone = String(phone).replace(/^\+?88/, "");

    const order = await orderModel.findOne({ _id: orderId }).lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const orderPhone = String(order?.address?.phone || "").replace(
      /^\+?88/,
      ""
    );
    if (!orderPhone || orderPhone !== normPhone) {
      return res
        .status(403)
        .json({ success: false, message: "Phone does not match this order" });
    }

    const safe = sanitizeOrderForUser(order);
    return res.json({ success: true, order: safe });
  } catch (error) {
    console.error("trackOrderLookup:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getMyOrderById = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { orderId } = req.params;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: "orderId is required" });
    }

    const order = await orderModel.findOne({ _id: orderId, userId });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const safe = sanitizeOrderForUser(order);
    return res.json({ success: true, order: safe });
  } catch (error) {
    console.error("getMyOrderById:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------- Exports -----------------------
export {
  // lists/updates
  allOrders,
  bkashCallback,
  // bKash Hosted (Normal) Checkout
  bkashCreatePayment,
  // courier
  courierCheck,
  getMyOrderById,
  // SSL
  initiateSslPayment,
  // core
  placeOrder,
  sslCancel,
  sslFail,
  sslIpn,
  sslSuccess,
  trackOrderLookup,
  // tracking
  trackOrderMine,
  // admin helpers
  updateOrderAddress,
  updateStatus,
  userOrders,
};
