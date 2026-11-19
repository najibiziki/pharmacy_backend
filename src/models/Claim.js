const mongoose = require("mongoose");

const claimSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    fullName: String,
    personalPhone: String,
    licenseNumber: String,
    verificationMethod: { type: String, default: "documents" },
    documents: {
      license: { public_id: String, url: String },
      storefront: { public_id: String, url: String },
    },
    reference: {
      type: String,
      unique: true,
      default: () =>
        `CLM-${Date.now().toString(36).toUpperCase()}${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`,
    },
    reviewedAt: Date,
    reviewNote: String,
  },
  { timestamps: true },
);

// only ONE pending claim per pharmacy
claimSchema.index(
  { pharmacyId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

module.exports = mongoose.model("Claim", claimSchema);
