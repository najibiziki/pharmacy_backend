const express = require("express");
const mongoose = require("mongoose");
const OpeningHours = require("opening_hours");
const Pharmacy = require("../models/Pharmacy");
const authMiddleware = require("../middleware/authMiddleware");
// This app evaluates pharmacy schedules in Morocco's time zone.
process.env.TZ = "Africa/Casablanca";

const router = express.Router();

const SEARCH_LIMITS = [50, 100, 250, 500, 1000, 2000];

// ── Schedule helpers ──────────────────────────────────────────────

// Legacy OSM string parser (kept for unclaimed pharmacies)
function isOpenAtCurrentTime(schedule) {
  if (typeof schedule !== "string" || !schedule.trim()) {
    return false;
  }

  try {
    const openingHours = new OpeningHours(schedule);
    return openingHours.getState(new Date()) === true;
  } catch (error) {
    // Missing or invalid schedules are not considered open.
    return false;
  }
}

// "08:30" → 510 minutes
function parseTimeToMinutes(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const [hours, minutes] = value.trim().split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

// Handles windows that cross midnight (garde 20:00 → 08:00).
function isTimeInRange(now, openValue, closeValue) {
  const open = parseTimeToMinutes(openValue);
  const close = parseTimeToMinutes(closeValue);
  if (open === null || close === null || open === close) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  if (open < close) return current >= open && current < close;
  return current >= open || current < close; // crosses midnight
}

// Is this pharmacy open right now, based on its schedule mode?
function isOpenBySchedule(pharmacy, now = new Date()) {
  const type = pharmacy.scheduleType || "normal";
  const gardeHours = Pharmacy.SCHEDULE_HOURS;

  if (type === "garde") {
    // Night duty: 20:00 → 08:00, while the owner keeps it selected.
    return isTimeInRange(now, gardeHours.garde.open, gardeHours.garde.close);
  }

  if (type === "dayGarde") {
    // Day duty: 08:30 → 20:00 (weekend / holiday), while selected.
    return isTimeInRange(
      now,
      gardeHours.dayGarde.open,
      gardeHours.dayGarde.close,
    );
  }

  // Normal: MON–FRI only, uses the pharmacy's own hours.
  const day = now.getDay(); // 0 = Sunday … 6 = Saturday
  if (day < 1 || day > 5) return false;

  // Open in the morning window OR the optional afternoon window.
  const inMorning = isTimeInRange(
    now,
    pharmacy.weekdayOpen,
    pharmacy.weekdayClose,
  );
  const hasAfternoon = !!pharmacy.weekdayOpen2 && !!pharmacy.weekdayClose2;
  const inAfternoon = hasAfternoon
    ? isTimeInRange(now, pharmacy.weekdayOpen2, pharmacy.weekdayClose2)
    : false;

  return inMorning || inAfternoon;
}

// Hours string shown in the popup — follows the mode automatically.
function getDisplayHours(pharmacy) {
  const type = pharmacy.scheduleType || "normal";
  const gardeHours = Pharmacy.SCHEDULE_HOURS;

  if (type === "garde")
    return `${gardeHours.garde.open}–${gardeHours.garde.close}`;
  if (type === "dayGarde")
    return `${gardeHours.dayGarde.open}–${gardeHours.dayGarde.close}`;

  const morning = `${pharmacy.weekdayOpen}–${pharmacy.weekdayClose}`;

  // midday gap → "MON–FRI: 08:30–12:30 & 14:30–18:30"
  if (pharmacy.weekdayOpen2 && pharmacy.weekdayClose2) {
    return `MON–FRI: ${morning} & ${pharmacy.weekdayOpen2}–${pharmacy.weekdayClose2}`;
  }
  return `MON–FRI: ${morning}`;
}

// Claimed pharmacies → owner's schedule mode rules.
// Unclaimed OSM pharmacies → the original OSM opening_hours string rules.
// This is the single source of truth for "is it open right now".
function isOpenNowForPharmacy(pharmacy, now = new Date()) {
  if (pharmacy.owner) return isOpenBySchedule(pharmacy, now);
  return isOpenAtCurrentTime(pharmacy.openingHours);
}

// GET /api/pharmacies/osm?lat=31.6295&lng=-7.9811
// Optional:
//   ?includeClosed=true → also returns closed pharmacies (each with real isOpenNow)
//   ?myPharmacyId=xxx   → the owner always gets their own pharmacy back,
//                         even when it is closed (so they can switch duty
//                         mode back from the map). Visitors are unaffected.
router.get("/osm", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const includeClosed = req.query.includeClosed === "true";
  const myPharmacyId =
    typeof req.query.myPharmacyId === "string" &&
    mongoose.Types.ObjectId.isValid(req.query.myPharmacyId)
      ? req.query.myPharmacyId
      : null;

  if (
    req.query.lat === undefined ||
    req.query.lng === undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid latitude and longitude are required.",
    });
  }

  try {
    const query = {
      source: "osm",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
        },
      },
    };

    let openPharmacies = [];

    for (const limit of SEARCH_LIMITS) {
      const candidates = await Pharmacy.find(query)
        .limit(limit)
        .select(
          "name address location source osmId osmType openingHours scheduleType weekdayOpen weekdayClose weekdayOpen2 weekdayClose2 isClaimed claimStatus phone owner",
        )
        .lean();

      // MongoDB returns candidates ordered by distance.
      const pool = includeClosed
        ? candidates
        : candidates.filter((pharmacy) => isOpenNowForPharmacy(pharmacy));

      openPharmacies = pool.slice(0, 10);

      if (openPharmacies.length >= 10 || candidates.length < limit) {
        break;
      }
    }

    // Owners always see their own pharmacy on the map — even closed —
    // so they can switch the duty mode back. Visitors never see it.
    if (myPharmacyId) {
      const alreadyIncluded = openPharmacies.some(
        (pharmacy) => pharmacy._id && pharmacy._id.toString() === myPharmacyId,
      );

      if (!alreadyIncluded) {
        const mine = await Pharmacy.findById(myPharmacyId)
          .select(
            "name address location source osmId osmType openingHours scheduleType weekdayOpen weekdayClose weekdayOpen2 weekdayClose2 isClaimed claimStatus phone owner",
          )
          .lean();

        if (mine) {
          openPharmacies.push(mine);
        }
      }
    }

    return res.json({
      success: true,
      source: "mongodb",
      count: openPharmacies.length,
      pharmacies: openPharmacies.map((pharmacy) => ({
        id: `osm-${pharmacy.osmType}-${pharmacy.osmId}`,
        _id: pharmacy._id.toString(),
        name: pharmacy.name,
        address: pharmacy.address,
        latitude: pharmacy.location.coordinates[1],
        longitude: pharmacy.location.coordinates[0],
        source: pharmacy.source,
        openingHours: pharmacy.openingHours,
        // computed on the backend — the real open/closed state right now
        isOpenNow: isOpenNowForPharmacy(pharmacy),
        scheduleType: pharmacy.scheduleType || "normal",
        weekdayOpen: pharmacy.weekdayOpen || null,
        weekdayClose: pharmacy.weekdayClose || null,
        weekdayOpen2: pharmacy.weekdayOpen2 || null,
        weekdayClose2: pharmacy.weekdayClose2 || null,
        displayHours: getDisplayHours(pharmacy),
        isClaimed: pharmacy.isClaimed === true,
        claimStatus: pharmacy.claimStatus || null,
        phone: pharmacy.phone || null,
        owner: pharmacy.owner || null,
      })),
    });
  } catch (error) {
    console.error("Nearby pharmacy query failed:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load nearby pharmacies.",
    });
  }
});

// GET /api/pharmacies/mine — the pharmacy owned by the logged-in user
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({
      owner: req.user._id || req.user.id,
    });
    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: "No pharmacy linked to your account yet.",
      });
    }
    res.json({
      success: true,
      pharmacy: {
        ...pharmacy.toObject(),
        isOpenNow: isOpenNowForPharmacy(pharmacy),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/pharmacies/:id — one pharmacy (used by the claim & details pages)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const pharmacy = await Pharmacy.findById(id).lean();
    if (!pharmacy) {
      return res
        .status(404)
        .json({ success: false, message: "Pharmacy not found." });
    }
    res.json({
      success: true,
      pharmacy: {
        ...pharmacy,
        isOpenNow: isOpenNowForPharmacy(pharmacy),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
