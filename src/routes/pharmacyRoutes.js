const express = require("express");
const mongoose = require("mongoose");
const Pharmacy = require("../models/Pharmacy");
const authMiddleware = require("../middleware/authMiddleware");
const router = express.Router();

const VALID_SCHEDULE_TYPES = ["normal", "garde", "dayGarde"];
const VALID_TIME = /^([01]?\d|2[0-3]):[0-5]\d$/; // "08:30", "19:45" …

router.patch("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }

    const pharmacy = await Pharmacy.findById(id);
    if (!pharmacy) {
      return res
        .status(404)
        .json({ success: false, message: "Pharmacy not found." });
    }

    const userId = req.user._id || req.user.id;
    const isOwner =
      pharmacy.owner && pharmacy.owner.toString() === userId.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Only the owner can edit." });
    }

    // schedule mode must be one of the 3 buttons
    if (
      req.body.scheduleType !== undefined &&
      !VALID_SCHEDULE_TYPES.includes(req.body.scheduleType)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid schedule type." });
    }

    // the optional afternoon window can be cleared with "" — normalize to null
    for (const field of ["weekdayOpen2", "weekdayClose2"]) {
      if (req.body[field] === "") req.body[field] = null;
    }

    // hours must be real times (null = cleared, only allowed for the afternoon pair)
    for (const field of [
      "weekdayOpen",
      "weekdayClose",
      "weekdayOpen2",
      "weekdayClose2",
    ]) {
      const value = req.body[field];
      if (value === undefined || value === null) continue;
      if (!VALID_TIME.test(value)) {
        return res
          .status(400)
          .json({ success: false, message: `Invalid ${field}.` });
      }
    }

    // whitelist — never allow location, osmId, owner, isClaimed here
    const allowed = [
      "name",
      "address",
      "openingHours",
      "phone",
      "scheduleType",
      "weekdayOpen",
      "weekdayClose",
      "weekdayOpen2",
      "weekdayClose2",
    ];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) pharmacy[field] = req.body[field];
    });

    await pharmacy.save();

    res.json({ success: true, pharmacy });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
