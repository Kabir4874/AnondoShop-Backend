import express from "express";
import {
  addProduct,
  editProduct,
  getSingleProduct,
  listProducts,
  removeProduct,
} from "../controllers/productController.js";
import adminAuth from "../middleware/adminAuth.js";
import upload from "../middleware/multer.js";

const productRouter = express.Router();

// Common image fields for add/edit
const imageFields = [
  { name: "image1", maxCount: 1 },
  { name: "image2", maxCount: 1 },
  { name: "image3", maxCount: 1 },
  { name: "image4", maxCount: 1 },
];

// Add product
productRouter.post("/add", adminAuth, upload.fields(imageFields), addProduct);

// Edit product (delete removed images from Cloudinary, upload new ones)
productRouter.post("/edit", adminAuth, upload.fields(imageFields), editProduct);

// Remove product
productRouter.post("/remove", adminAuth, removeProduct);

// Get a single product (by body: { productId })
productRouter.post("/single", getSingleProduct);

// List products
productRouter.get("/list", listProducts);

export default productRouter;
