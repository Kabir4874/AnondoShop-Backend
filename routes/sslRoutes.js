// routes/sslRoutes.js
import express from "express";
import SSLCommerzPayment from "sslcommerz-lts";
import authUser from "../middleware/auth.js"; // <<— make sure this exports req.userId
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";

const router = express.Router();

// Apply auth to all SSL routes so req.userId is available
router.use(authUser);

const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWORD;
const is_live = (process.env.SSLCZ_IS_LIVE || "false") === "true";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

function generateTransactionId() {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rnd}`;
}

/**
 * POST /api/ssl/initiate
 * Body: { items[], amount, address{} }
 * Header: { token }  -> authUser sets req.userId
 */
router.post("/initiate", async (req, res) => {
  try {
    // userId comes from auth middleware (token)
    const userIdFromAuth = req.userId || req.user?._id;
    const { items, amount, address } = req.body;

    if (!userIdFromAuth) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!amount || !items?.length || !address) {
      return res
        .status(400)
        .json({
          success: false,
          message: "items, amount, and address are required",
        });
    }

    // 1) Create pending order
    const orderData = {
      userId: userIdFromAuth,
      items,
      address,
      amount,
      paymentMethod: "SSLCommerz",
      payment: false,
      status: "Order Placed",
      date: Date.now(),
    };

    const newOrder = new orderModel(orderData);
    await newOrder.save();

    // 2) Prepare SSLCommerz payload
    const tran_id = generateTransactionId();

    const data = {
      total_amount: amount,
      currency: "BDT",
      tran_id,
      success_url: `${req.protocol}://${req.get("host")}/api/ssl/success`,
      fail_url: `${req.protocol}://${req.get("host")}/api/ssl/fail`,
      cancel_url: `${req.protocol}://${req.get("host")}/api/ssl/cancel`,
      ipn_url: `${req.protocol}://${req.get("host")}/api/ssl/ipn`,
      shipping_method: "Courier",
      product_name: "Cart Products",
      product_category: "Ecommerce",
      product_profile: "general",

      // Customer info (fallbacks)
      cus_name:
        `${address.firstName || ""} ${address.lastName || ""}`.trim() ||
        "Customer",
      cus_email: address.email || "customer@example.com",
      cus_add1: address.street || "Address Line 1",
      cus_add2: "N/A",
      cus_city: address.city || "Dhaka",
      cus_state: address.state || "Dhaka",
      cus_postcode: address.zipcode || "1000",
      cus_country: address.country || "Bangladesh",
      cus_phone: address.phone || "01700000000",
      cus_fax: "N/A",

      // Shipping info
      ship_name: "Shipping",
      ship_add1: address.street || "Address Line 1",
      ship_add2: "N/A",
      ship_city: address.city || "Dhaka",
      ship_state: address.state || "Dhaka",
      ship_postcode: address.zipcode || "1000",
      ship_country: address.country || "Bangladesh",

      // Pass IDs so they come back on callbacks
      value_a: newOrder._id.toString(), // orderId
      value_b: userIdFromAuth, // userId
    };

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const apiResponse = await sslcz.init(data);

    const GatewayPageURL = apiResponse?.GatewayPageURL;
    if (!GatewayPageURL) {
      await orderModel.findByIdAndDelete(newOrder._id); // cleanup
      return res
        .status(500)
        .json({ success: false, message: "SSLCommerz init failed" });
    }

    res.json({ success: true, url: GatewayPageURL, orderId: newOrder._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/success", async (req, res) => {
  try {
    const { value_a: orderId, value_b: userId } = req.body || {};
    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, {
        payment: true,
        paymentMethod: "SSLCommerz",
      });
    }
    if (userId) {
      await userModel.findByIdAndUpdate(userId, { cartData: {} });
    }
    return res.redirect(
      `${CLIENT_URL}/payment-result?status=success&orderId=${orderId || ""}`
    );
  } catch (err) {
    console.error(err);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
});

router.post("/fail", async (req, res) => {
  try {
    const { value_a: orderId } = req.body || {};
    if (orderId) {
      await orderModel.findByIdAndUpdate(orderId, { status: "Payment Failed" });
    }
    return res.redirect(
      `${CLIENT_URL}/payment-result?status=failed&orderId=${orderId || ""}`
    );
  } catch (err) {
    console.error(err);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
});

router.post("/cancel", async (req, res) => {
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
  } catch (err) {
    console.error(err);
    return res.redirect(`${CLIENT_URL}/payment-result?status=error`);
  }
});

router.post("/ipn", async (req, res) => {
  console.log("SSL IPN:", req.body);
  res.status(200).send("OK");
});

export default router;
