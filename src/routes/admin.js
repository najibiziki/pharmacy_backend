const router = require("express").Router();
const Claim = require("../models/Claim");
const Pharmacy = require("../models/Pharmacy");
const authMiddleware = require("../middleware/authMiddleware");

// admin check
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin only." });
  }
  next();
}

// GET /api/admin/claims?status=pending
router.get("/claims", authMiddleware, adminOnly, async (req, res) => {
  try {
    const status = ["pending", "approved", "rejected"].includes(
      req.query.status,
    )
      ? req.query.status
      : "pending";

    const claims = await Claim.find({ status })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("pharmacyId", "name")
      .populate("userId", "name email")
      .lean();

    res.json({ success: true, claims });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/admin/claims/:id/approve
router.patch(
  "/claims/:id/approve",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const claim = await Claim.findById(req.params.id);
      if (!claim)
        return res
          .status(404)
          .json({ success: false, message: "Claim not found." });
      if (claim.status !== "pending")
        return res
          .status(400)
          .json({ success: false, message: "Already reviewed." });

      const pharmacy = await Pharmacy.findById(claim.pharmacyId);
      if (!pharmacy)
        return res
          .status(404)
          .json({ success: false, message: "Pharmacy not found." });

      // copy useful data onto the pharmacy
      pharmacy.isClaimed = true;
      pharmacy.phone = claim.personalPhone;
      pharmacy.owner = claim.userId;
      pharmacy.claimStatus = "none"; // ← NEW: review finished, no longer pending
      await pharmacy.save();

      claim.status = "approved";
      claim.reviewedAt = new Date();
      await claim.save();

      res.json({ success: true, message: "Claim approved." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error." });
    }
  },
);

// PATCH /api/admin/claims/:id/reject
router.patch(
  "/claims/:id/reject",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const claim = await Claim.findById(req.params.id);
      if (!claim)
        return res
          .status(404)
          .json({ success: false, message: "Claim not found." });
      if (claim.status !== "pending")
        return res
          .status(400)
          .json({ success: false, message: "Already reviewed." });

      claim.status = "rejected";
      claim.reviewedAt = new Date();
      if (req.body?.note) claim.reviewNote = req.body.note;
      await claim.save();

      // ← NEW: release the pharmacy so the Claim button comes back
      // and the owner can fix his documents and resubmit
      await Pharmacy.findByIdAndUpdate(claim.pharmacyId, {
        claimStatus: "none",
      });

      res.json({ success: true, message: "Claim rejected." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error." });
    }
  },
);

// GET /api/admin/pharmacies?search=&status=all|pending|claimed|unclaimed
router.get("/pharmacies", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { search = "", status = "all" } = req.query;
    const q = {};
    if (search.trim()) q.name = { $regex: search.trim(), $options: "i" };

    if (status === "claimed") q.isClaimed = true;
    if (status === "unclaimed") q.isClaimed = { $ne: true };
    if (status === "pending") {
      const pend = await Claim.find({ status: "pending" }).distinct(
        "pharmacyId",
      );
      q._id = { $in: pend };
    }

    const pharmacies = await Pharmacy.find(q)
      .select("name isClaimed phone updatedAt")
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    const ids = pharmacies.map((p) => p._id);
    const pendClaims = await Claim.find({
      pharmacyId: { $in: ids },
      status: "pending",
    })
      .select("pharmacyId reference createdAt")
      .lean();

    const pendMap = {};
    for (const c of pendClaims) pendMap[c.pharmacyId.toString()] = c;

    res.json({
      success: true,
      pharmacies: pharmacies.map((p) => ({
        ...p,
        pendingClaim: pendMap[p._id.toString()] || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/admin/pharmacies/:id — detail + all its claims
router.get("/pharmacies/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findById(req.params.id).lean();
    if (!pharmacy)
      return res
        .status(404)
        .json({ success: false, message: "Pharmacy not found." });

    const claims = await Claim.find({ pharmacyId: pharmacy._id })
      .sort({ createdAt: -1 })
      .populate("userId", "name email")
      .lean();

    res.json({ success: true, pharmacy, claims });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router; 
