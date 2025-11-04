import jwt from "jsonwebtoken";

const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const token = bearer || req.headers.token;

    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }
    const legacyOK =
      typeof decoded === "string" &&
      decoded === process.env.ADMIN_EMAIL + process.env.ADMIN_PASSWORD;

    const objectOK =
      decoded &&
      typeof decoded === "object" &&
      decoded.role === "admin" &&
      decoded.email === process.env.ADMIN_EMAIL;

    if (!legacyOK && !objectOK) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    req.admin = objectOK
      ? { email: decoded.email }
      : { email: process.env.ADMIN_EMAIL };

    next();
  } catch (error) {
    console.log("Error while authenticating admin: ", error);
    return res.status(401).json({ success: false, message: "Unauthorized!" });
  }
};

export default adminAuth;
