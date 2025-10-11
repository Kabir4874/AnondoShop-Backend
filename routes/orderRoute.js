// routes/orderroutes.js
import express from "express";
import {
  allOrders,
  // SSLCommerz handlers
  initiateSslPayment,
  placeOrder,
  sslCancel,
  sslFail,
  sslIpn,
  sslSuccess,
  updateStatus,
  userOrders,
} from "../controllers/orderController.js";
import adminAuth from "../middleware/adminAuth.js";
import authUser from "../middleware/auth.js";

const orderRouter = express.Router();

/* Admin */
orderRouter.post("/list", adminAuth, allOrders);
orderRouter.post("/status", adminAuth, updateStatus);

/* Customer: COD */
orderRouter.post("/place", authUser, placeOrder);

/* Customer: My orders */
orderRouter.post("/userorders", authUser, userOrders);

/* SSLCommerz */
// Initiate payment (protected)
orderRouter.post("/ssl/initiate", authUser, initiateSslPayment);

// Callbacks (NOT protected — SSLCommerz posts here)
orderRouter.post("/ssl/success", sslSuccess);
orderRouter.post("/ssl/fail", sslFail);
orderRouter.post("/ssl/cancel", sslCancel);
orderRouter.post("/ssl/ipn", sslIpn);

export default orderRouter;
