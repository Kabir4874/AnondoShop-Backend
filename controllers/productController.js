import { v2 as cloudinary } from "cloudinary";
import productModel from "../models/productModel.js";

async function uploadImagesReturnMeta(files = []) {
  const uploads = files.map(async (file) => {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
    });
    return { url: result.secure_url, publicId: result.public_id };
  });
  return Promise.all(uploads);
}

async function destroyImagesByPublicIds(publicIds = []) {
  const tasks = publicIds.map((pid) =>
    cloudinary.uploader.destroy(pid).catch(() => null)
  );
  await Promise.all(tasks);
}

const addProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      longDescription = "",
      price,
      discount = 0,
      category,
      subCategory,
      sizes,
      bestSeller,
    } = req.body;

    const image1 = req.files?.image1?.[0];
    const image2 = req.files?.image2?.[0];
    const image3 = req.files?.image3?.[0];
    const image4 = req.files?.image4?.[0];

    const productImages = [image1, image2, image3, image4].filter(Boolean);

    const imageMeta = await uploadImagesReturnMeta(productImages);

    const productData = {
      name,
      description,
      longDescription, // may be HTML or markdown
      price: Number(price),
      discount: Number(discount) || 0,
      category,
      subCategory,
      sizes: Array.isArray(sizes) ? sizes : JSON.parse(sizes),
      bestSeller: String(bestSeller) === "true",
      image: imageMeta, // [{url, publicId}]
      date: Date.now(),
    };

    const product = new productModel(productData);
    await product.save();

    res.status(201).json({ success: true, message: "Product added" });
  } catch (error) {
    console.log("Error while adding product: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const editProduct = async (req, res) => {
  try {
    const {
      productId,
      name,
      description,
      longDescription = "",
      price,
      discount = 0,
      category,
      subCategory,
      sizes,
      bestSeller,
      removedPublicIds = "[]",
    } = req.body;

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }

    const product = await productModel.findById(productId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const toRemove = JSON.parse(removedPublicIds);
    if (Array.isArray(toRemove) && toRemove.length) {
      await destroyImagesByPublicIds(toRemove);
      product.image = product.image.filter(
        (img) => !toRemove.includes(img.publicId)
      );
    }

    const newFiles = [
      req.files?.image1?.[0],
      req.files?.image2?.[0],
      req.files?.image3?.[0],
      req.files?.image4?.[0],
    ].filter(Boolean);

    if (newFiles.length) {
      const newMeta = await uploadImagesReturnMeta(newFiles);
      product.image = [...product.image, ...newMeta];
    }

    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (longDescription !== undefined)
      product.longDescription = longDescription;
    if (price !== undefined) product.price = Number(price);
    if (discount !== undefined) product.discount = Number(discount) || 0;
    if (category !== undefined) product.category = category;
    if (subCategory !== undefined) product.subCategory = subCategory;

    if (sizes !== undefined) {
      product.sizes = Array.isArray(sizes) ? sizes : JSON.parse(sizes);
    }
    if (bestSeller !== undefined) {
      product.bestSeller = String(bestSeller) === "true";
    }

    await product.save();

    res
      .status(200)
      .json({ success: true, message: "Product updated", product });
  } catch (error) {
    console.log("Error while editing product: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const listProducts = async (req, res) => {
  try {
    const products = await productModel.find({});
    res.status(200).json({ success: true, products });
  } catch (error) {
    console.log("Error while fetching all products: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const removeProduct = async (req, res) => {
  try {
    const { id } = req.body;
    const product = await productModel.findById(id);
    if (product?.image?.length) {
      await destroyImagesByPublicIds(product.image.map((i) => i.publicId));
    }
    await productModel.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: "Product removed" });
  } catch (error) {
    console.log("Error while removing product: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSingleProduct = async (req, res) => {
  try {
    const { productId } = req.body;
    const product = await productModel.findById(productId);
    res.status(200).json({ success: true, product });
  } catch (error) {
    console.log("Error while fetching single product: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export {
  addProduct,
  editProduct,
  getSingleProduct,
  listProducts,
  removeProduct,
};
