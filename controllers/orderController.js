// controllers/orderController.js
import SSLCommerzPayment from "sslcommerz-lts";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";

const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWORD;
const is_live = (process.env.SSLCZ_IS_LIVE || "false") === "true";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

/* ----------------------- Utilities ----------------------- */
function generateTransactionId() {
  const ts = Date.now().toString();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rnd}`;
}

/* ----------------------- COD ----------------------- */
const placeOrder = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId; // prefer token, fallback body
    const { items, amount, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!amount || !items?.length || !address) {
      return res.status(400).json({
        success: false,
        message: "items, amount, and address are required",
      });
    }

    const orderData = {
      userId,
      items,
      address,
      amount,
      paymentMethod: "COD",
      payment: false,
      date: Date.now(),
      status: "Order Placed",
    };

    const newOrder = new orderModel(orderData);
    await newOrder.save();

    await userModel.findByIdAndUpdate(userId, { cartData: {} });

    res.json({ success: true, message: "Order Placed", orderId: newOrder._id });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

/* ----------------------- SSLCommerz: Initiate ----------------------- */
/**
 * POST /api/order/ssl/initiate
 * Headers: { token } -> authUser sets req.userId
 * Body: { items[], amount, address{} }
 */
const initiateSslPayment = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId; // prefer token, fallback body
    const { items, amount, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!amount || !items?.length || !address) {
      return res.status(400).json({
        success: false,
        message: "items, amount, and address are required",
      });
    }

    // 1) Create pending order
    const newOrder = await orderModel.create({
      userId,
      items,
      address,
      amount,
      paymentMethod: "SSLCommerz",
      payment: false,
      status: "Order Placed",
      date: Date.now(),
    });

    // 2) Prepare SSLCommerz payload
    const tran_id = generateTransactionId();
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const data = {
      total_amount: amount,
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

      // Extra values: returned on callbacks
      value_a: newOrder._id.toString(), // orderId
      value_b: userId, // userId
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

/* ----------------------- SSLCommerz: Callbacks ----------------------- */
// NOTE: These are NOT behind auth — SSLCommerz posts to them.

/** SSL SUCCESS (POST) */
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

/** SSL FAIL (POST) */
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

/** SSL CANCEL (POST) */
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

/** SSL IPN (POST) — optional validation hook */
const sslIpn = async (req, res) => {
  try {
    console.log("SSL IPN:", req.body);
    // You can verify payment here via SSLCommerz validation API if needed.
    res.status(200).send("OK");
  } catch (error) {
    console.log(error);
    res.status(500).send("ERR");
  }
};

/* ----------------------- Lists & Updates ----------------------- */
const allOrders = async (req, res) => {
  try {
    const orders = await orderModel.find({});
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const userOrders = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const orders = await orderModel.find({ userId });
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;
    await orderModel.findByIdAndUpdate(orderId, { status });
    res.json({ success: true, message: "Status Updated" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export {
  // lists/updates
  allOrders,
  // ssl
  initiateSslPayment,
  // core
  placeOrder,
  sslCancel,
  sslFail,
  sslIpn,
  sslSuccess,
  updateStatus,
  userOrders,
};
