import axios from "axios";
import SSLCommerzPayment from "sslcommerz-lts";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";

const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWORD;
const is_live = (process.env.SSLCZ_IS_LIVE || "false") === "true";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const COURIER_API = process.env.COURIER_API;

/* ----------------------- Utilities ----------------------- */
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

/* ----------------------- COD ----------------------- */
const placeOrder = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId; // set by authUser
    const { items, amount, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!Array.isArray(items) || items.length === 0 || !amount) {
      return res.status(400).json({
        success: false,
        message: "items and amount are required",
      });
    }

    // Validate BD address (new minimal schema)
    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    const orderData = {
      userId,
      items,
      address, // { recipientName, phone, addressLine1, district, postalCode }
      amount,
      paymentMethod: "COD",
      payment: false,
      date: Date.now(),
      status: "Order Placed",
    };

    const newOrder = new orderModel(orderData);
    await newOrder.save();

    // Clear cart after placing order
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
 * Body: { items[], amount, address{recipientName, phone, addressLine1, district, postalCode} }
 */
const initiateSslPayment = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    const { items, amount, address } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: userId missing" });
    }
    if (!Array.isArray(items) || items.length === 0 || !amount) {
      return res.status(400).json({
        success: false,
        message: "items and amount are required",
      });
    }

    // Validate BD address
    const addrError = validateBdAddress(address);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    // Grab user email for SSLCommerz payload fallback
    const user = await userModel.findById(userId).select("email").lean();
    const userEmail = user?.email || "customer@example.com";

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

    // 2) Prepare SSLCommerz payload using minimal BD address
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

      // Customer info
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

      // Shipping info
      ship_name: address.recipientName || "Shipping",
      ship_add1: address.addressLine1 || "Address Line 1",
      ship_add2: "N/A",
      ship_city: address.district || "Dhaka",
      ship_state: address.district || "Dhaka",
      ship_postcode: address.postalCode || "1000",
      ship_country: "Bangladesh",

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
    // Optional: verify payment using SSLCommerz validation API
    res.status(200).send("OK");
  } catch (error) {
    console.log(error);
    res.status(500).send("ERR");
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
    const orders = await orderModel.find({ userId }).sort({ date: -1 });
    res.json({ success: true, orders });
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

/* ----------------------- NEW: Update Order Address (Admin) ----------------------- */
/**
 * POST /api/order/update-address
 * Headers: { token }  (admin protected via route middleware)
 * Body: { orderId, address: { recipientName, phone, addressLine1, district, postalCode } }
 */
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

export {
  // lists/updates
  allOrders,
  updateStatus,
  userOrders,

  // core
  placeOrder,

  // address
  updateOrderAddress,

  // SSL
  initiateSslPayment,
  sslCancel,
  sslFail,
  sslIpn,
  sslSuccess,

  // courier
  courierCheck,
};
