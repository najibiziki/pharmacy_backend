const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function authMiddleware(req, res, next) {
  try {
    // 1. Read the Authorization header.
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Extract the JWT.
    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 3. Verify the token signature and expiration.
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        message: "Internal server error.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4. Find the current user in the database.
    const user = await User.findById(decoded.sub).select("_id name email role");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication credentials.",
      });
    }

    // 5. Make the authenticated user available to downstream handlers.
    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };

    return next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token.",
      });
    }

    return next(error);
  }
}

module.exports = authMiddleware;
