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

/* Admin */
orderRouter.post("/list", adminAuth, allOrders);
orderRouter.post("/status", adminAuth, updateStatus);
orderRouter.post("/courier/check", adminAuth, courierCheck);
orderRouter.post("/update-address", adminAuth, updateOrderAddress);

/* Customer: COD */
orderRouter.post("/place", authUser, placeOrder);

/* Customer: My orders */
orderRouter.post("/userorders", authUser, userOrders);

/* Customer: Track (authenticated) */
orderRouter.get("/track/:orderId", authUser, trackOrderMine);

/* Customer: Track (public lookup with orderId + phone) */
orderRouter.post("/track/lookup", trackOrderLookup);

/* Optional: fetch one of my orders by id (same as /track/:orderId, different path) */
orderRouter.get("/my/:orderId", authUser, getMyOrderById);

/* SSLCommerz */
// Initiate payment (protected)
orderRouter.post("/ssl/initiate", authUser, initiateSslPayment);

orderRouter.post("/ssl/success", sslSuccess);
orderRouter.post("/ssl/fail", sslFail);
orderRouter.post("/ssl/cancel", sslCancel);
orderRouter.post("/ssl/ipn", sslIpn);

/* bKash Hosted (Normal) Checkout */
orderRouter.post("/bkash/create", authUser, bkashCreatePayment);
orderRouter.get("/bkash/callback", bkashCallback);

export default orderRouter;
