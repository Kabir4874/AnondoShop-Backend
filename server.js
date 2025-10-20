import cors from "cors";
import "dotenv/config";
import express from "express";
import connectCloudinary from "./config/cloudinary.js";
import connectDB from "./config/mongodb.js";
import cartRouter from "./routes/cartRoute.js";
import categoryRouter from "./routes/categoryRoute.js";
import contentRouter from "./routes/contentRoutes.js";
import orderRouter from "./routes/orderRoute.js";
import productRouter from "./routes/productRoute.js";
import userRouter from "./routes/userRoute.js";

const app = express();
const port = process.env.PORT;
connectDB();
connectCloudinary();

app.use(express.json());
app.use(cors());

app.use("/api/user", userRouter);
app.use("/api/product", productRouter);
app.use("/api/cart", cartRouter);
app.use("/api/order", orderRouter);
app.use("/api/category", categoryRouter);
app.use("/api/content", contentRouter);

app.get("/", (req, res) => {
  res.send("API is running...");
});

app.listen(port, () =>
  console.log(`Server is running on at http://localhost:${port}`)
);
