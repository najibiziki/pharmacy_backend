const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const osmRoutes = require("./routes/osmRoutes");
const authRoutes = require("./routes/authRoutes");
const claimRoutes = require("./routes/claims");
const adminRoutes = require("./routes/admin");
const pharmacyRoutes = require("./routes/pharmacyRoutes");
const app = express();

app.use(helmet());

app.use(
  cors({
    origin: [
      "https://pharmacy-frontend-fawn.vercel.app",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Pharmacy Finder API is running",
  });
});

app.use("/api/pharmacies", osmRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", claimRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pharmacies", pharmacyRoutes);
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

module.exports = app;
