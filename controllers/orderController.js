import axios from "axios";
import SSLCommerzPayment from "sslcommerz-lts";
import orderModel from "../models/orderModel.js";
import productModel from "../models/productModel.js";
import userModel from "../models/userModel.js";

/* ----------------------- ENV / Config ----------------------- */
const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWORD;
const is_live = (process.env.SSLCZ_IS_LIVE || "false") === "true";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const COURIER_API = process.env.COURIER_API;

// bKash Hosted (Normal) Checkout
const BKASH_CHECKOUT_GRANT_URL = process.env.BKASH_CHECKOUT_GRANT_URL;
const BKASH_CHECKOUT_CREATE_URL = process.env.BKASH_CHECKOUT_CREATE_URL;
const BKASH_CHECKOUT_EXECUTE_URL = process.env.BKASH_CHECKOUT_EXECUTE_URL;
const BKASH_CHECKOUT_CALLBACK_URL = process.env.BKASH_CHECKOUT_CALLBACK_URL;

const BKASH_USERNAME = process.env.BKASH_USERNAME;
const BKASH_PASSWORD = process.env.BKASH_PASSWORD;
const BKASH_APP_KEY = process.env.BKASH_APP_KEY;
const BKASH_APP_SECRET = process.env.BKASH_APP_SECRET;

/* ----------------------- bKash Hosted Token Cache ----------------------- */
let bkashHostedIdToken = null;
let bkashHostedTokenExpiry = 0; // epoch ms

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
    const expiresIn = Number(data.expires_in || 3600); // seconds
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
    authorization: idToken, // raw token per Hosted docs (not Bearer)
    "x-app-key": BKASH_APP_KEY,
  };
}

/* ----------------------- Helpers ----------------------- */
function generateTransactionId() {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rnd}`;
}

function validateBdAddress(addr) {
  if (!addr) return "Address is required";
  const { recipientName, phone, addressLine1, district, postalCode } = addr;
  if (!recipientName || !phone || !addressLine1 || !district || !postalCode) {
    return "recipientName, phone, addressLine1, district, postalCode are required";
  }
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(String(phone))) {
    return "Invalid Bangladesh phone number";
  }
  if (!/^\d{4}$/.test(String(postalCode))) {
    return "Postal code must be 4 digits";
  }
  return null;
}

function isXXL(size) {
  if (!size) return false;
  const s = String(size).toUpperCase();
  return s.startsWith("XXL");
}

function computeDeliveryFee(address) {
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

async function computeTotalsFromDB(items, address) {
  const norm = normalizeItems(items).filter(
    (x) => x.productId && x.quantity > 0
  );
  if (norm.length === 0) throw new Error("No valid items provided");

  const productIds = [...new Set(norm.map((x) => x.productId))];
  const products = await productModel
    .find({ _id: { $in: productIds } })
    .select("_id name price discount")
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
    });
  }

  const { fee: deliveryFee, label: deliveryLabel } =
    computeDeliveryFee(address);
  const computedAmount = subtotal + deliveryFee;

  return { computedAmount, deliveryFee, deliveryLabel, lines };
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
  // default
  return { progressPct: 15, step: "order placed" };
}

/** Provide a simple ETA window based on area & status (best-effort). */
function estimateDeliveryWindow(address, status) {
  const { label } = computeDeliveryFee(address || {});
  const base =
    label === "Dhaka"
      ? [1, 3]
      : label === "Gazipur" || label === "Savar/Ashulia"
      ? [2, 4]
      : [3, 7];

  // if already shipped/out for delivery, compress window a bit
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
    // keep minimal fields; exclude e.g. internal notes if you later add them
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
    image: it.image || [], // may be filled in userOrders enrich step; OK if missing
  }));

  const safeAddress = {
    recipientName: address.recipientName,
    phone: address.phone, // required for public lookup match; OK to return
    addressLine1: address.addressLine1,
    district: address.district,
    postalCode: address.postalCode,
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

/* ----------------------- COD ----------------------- */
const placeOrder = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { items, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    const { computedAmount, lines } = await computeTotalsFromDB(items, address);

    const newOrder = await orderModel.create({
      userId,
      items: lines,
      address,
      amount: computedAmount,
      paymentMethod: "COD",
      payment: false,
      date: Date.now(),
      status: "Order Placed",
    });

    await userModel.findByIdAndUpdate(userId, { cartData: {} });

    res.json({ success: true, message: "Order Placed", orderId: newOrder._id });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

/* ----------------------- SSLCommerz ----------------------- */
const initiateSslPayment = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { items, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    const { computedAmount, lines } = await computeTotalsFromDB(items, address);

    const user = await userModel.findById(userId).select("email").lean();
    const userEmail = user?.email || "customer@example.com";

    const newOrder = await orderModel.create({
      userId,
      items: lines,
      address,
      amount: computedAmount,
      paymentMethod: "SSLCommerz",
      payment: false,
      status: "Order Placed",
      date: Date.now(),
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

      cus_name: address.recipientName || "Customer",
      cus_email: userEmail,
      cus_add1: address.addressLine1 || "Address Line 1",
      cus_add2: "N/A",
      cus_city: address.district || "Dhaka",
      cus_state: address.district || "Dhaka",
      cus_postcode: address.postalCode || "1000",
      cus_country: "Bangladesh",
      cus_phone: address.phone || "01700000000",
      cus_fax: "N/A",

      ship_name: address.recipientName || "Shipping",
      ship_add1: address.addressLine1 || "Address Line 1",
      ship_add2: "N/A",
      ship_city: address.district || "Dhaka",
      ship_state: address.district || "Dhaka",
      ship_postcode: address.postalCode || "1000",
      ship_country: "Bangladesh",

      value_a: newOrder._id.toString(),
      value_b: userId,
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
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const sslSuccess = async (req, res) => {
  try {
    const { value_a: orderId, value_b: userId } = req.body || {};
    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, {
        payment: true,
        paymentMethod: "SSLCommerz",
        status: "Paid",
      });
    }
    if (userId) {
      await userModel.findByIdAndUpdate(userId, { cartData: {} });
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

const sslIpn = async (req, res) => {
  try {
    console.log("SSL IPN:", req.body);
    res.status(200).send("OK");
  } catch (error) {
    console.log(error);
    res.status(500).send("ERR");
  }
};

/* ----------------------- bKash Hosted (Normal) Checkout ----------------------- */
const bkashCreatePayment = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { items, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }

    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    const { computedAmount, lines } = await computeTotalsFromDB(items, address);

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

    return res.status(201).json({ success: true, orderId: order._id, data });
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
        const order = await orderModel.findByIdAndUpdate(
          orderId,
          { payment: true, paymentMethod: "bKash", status: "Paid" },
          { new: true }
        );
        if (order?.userId) {
          await userModel.findByIdAndUpdate(order.userId, { cartData: {} });
        }
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

/* ----------------------- Lists & Updates ----------------------- */
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
      phone: address.phone,
      addressLine1: address.addressLine1,
      district: address.district,
      postalCode: address.postalCode,
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

/* ----------------------- Courier: Delivery Rate Check ----------------------- */
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

/* ----------------------- Tracking: NEW ----------------------- */
/**
 * Authenticated: GET /api/order/track/:orderId
 * Returns sanitized order only if it belongs to the current user.
 */
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

/**
 * Public lookup: POST /api/order/track/lookup
 * Body: { orderId, phone }
 * Matches by _id and address.phone (Bangladesh number, with/without +88).
 * Returns sanitized order if match succeeds.
 */
const trackOrderLookup = async (req, res) => {
  try {
    const { orderId, phone } = req.body || {};
    if (!orderId || !phone) {
      return res.status(400).json({
        success: false,
        message: "orderId and phone are required",
      });
    }

    // Normalize phone for comparison: allow +88 and plain 01XXXXXXXXX
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

/**
 * Alias: GET /api/order/my/:orderId (same behavior as /track/:orderId)
 */
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

/* ----------------------- Exports ----------------------- */
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
