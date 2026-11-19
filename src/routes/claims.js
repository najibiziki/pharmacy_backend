const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const cloudinary = require("../config/cloudinary");
const Claim = require("../models/Claim");
const Pharmacy = require("../models/Pharmacy");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG, WEBP or PDF."), ok);
  },
});

function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

// POST /api/pharmacies/:pharmacyId/claims
router.post(
  "/pharmacies/:pharmacyId/claims",
  authMiddleware,
  upload.fields([
    { name: "license", maxCount: 1 },
    { name: "storefront", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { pharmacyId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(pharmacyId))
        return res.status(400).json({ success: false, message: "Invalid id." });

      const pharmacy = await Pharmacy.findById(pharmacyId);
      if (!pharmacy)
        return res
          .status(404)
          .json({ success: false, message: "Pharmacy not found." });
      if (pharmacy.isClaimed)
        return res
          .status(409)
          .json({ success: false, message: "Already claimed." });

      const pending = await Claim.findOne({ pharmacyId, status: "pending" });
      if (pending)
        return res.status(409).json({
          success: false,
          message: "A claim is already under review.",
        });

      const { fullName, personalPhone, licenseNumber } = req.body;
      if (
        !fullName ||
        !personalPhone ||
        !licenseNumber ||
        !req.files?.license ||
        !req.files?.storefront
      )
        return res
          .status(400)
          .json({ success: false, message: "Missing fields or documents." });

      // upload both photos to Cloudinary
      const [licenseUp, storefrontUp] = await Promise.all([
        uploadBuffer(req.files.license[0].buffer, "claims"),
        uploadBuffer(req.files.storefront[0].buffer, "claims"),
      ]);

      const claim = await Claim.create({
        pharmacyId,
        userId: req.user._id || req.user.id || req.user.sub,
        fullName,
        personalPhone,
        licenseNumber,
        verificationMethod: "documents",
        documents: {
          license: {
            public_id: licenseUp.public_id,
            url: licenseUp.secure_url,
          },
          storefront: {
            public_id: storefrontUp.public_id,
            url: storefrontUp.secure_url,
          },
        },
      });

      // mark the pharmacy as "under review" so the map popup shows it
      await Pharmacy.findByIdAndUpdate(pharmacyId, {
        claimStatus: "pending",
      });

      res.status(201).json({
        success: true,
        claim: { reference: claim.reference, status: claim.status },
      });
    } catch (err) {
      if (err.code === 11000)
        return res.status(409).json({
          success: false,
          message: "A claim is already under review.",
        });
      console.error("Claim submit failed:", err);
      res.status(500).json({ success: false, message: "Server error." });
    }
  },
);

module.exports = router;
