// routes/orderRouter.js
import express from "express";
import {
  allOrders,
  bkashCallback,
  bkashCreatePayment,
  courierCheck,
  getMyOrderById,
  initiateSslPayment,
  placeOrder,
  sslCancel,
  sslFail,
  sslIpn,
  sslSuccess,
  trackOrderLookup,
  trackOrderMine,
  updateOrderAddress,
  updateStatus,
  userOrders,
} from "../controllers/orderController.js";
import adminAuth from "../middleware/adminAuth.js";
import authUser from "../middleware/auth.js";

const orderRouter = express.Router();

/* ---------------- Admin ---------------- */
orderRouter.post("/list", adminAuth, allOrders);
orderRouter.post("/status", adminAuth, updateStatus);
orderRouter.post("/courier/check", adminAuth, courierCheck);
orderRouter.post("/update-address", adminAuth, updateOrderAddress);

/* ---------------- Customer: Place Order (COD) ----------------
   Unauthenticated: creates/ensures account by phone during checkout */
orderRouter.post("/place", placeOrder);

/* ---------------- Customer: My orders (requires token) ---------------- */
orderRouter.post("/userorders", authUser, userOrders);

/* ---------------- Customer: Tracking ---------------- */
orderRouter.get("/track/:orderId", authUser, trackOrderMine); // authenticated
orderRouter.post("/track/lookup", trackOrderLookup); // public by phone + orderId
orderRouter.get("/my/:orderId", authUser, getMyOrderById); // alias of track/:orderId

/* ---------------- SSLCommerz ---------------- */
// Initiate payment (unauthenticated; ensures account by phone)
orderRouter.post("/ssl/initiate", initiateSslPayment);

// Payment callbacks (SSLCommerz)
orderRouter.post("/ssl/success", sslSuccess);
orderRouter.post("/ssl/fail", sslFail);
orderRouter.post("/ssl/cancel", sslCancel);
orderRouter.post("/ssl/ipn", sslIpn);

/* ---------------- bKash Hosted (Normal) Checkout ---------------- */
// Create payment (unauthenticated; ensures account by phone)
orderRouter.post("/bkash/create", bkashCreatePayment);
orderRouter.get("/bkash/callback", bkashCallback);

export default orderRouter;
