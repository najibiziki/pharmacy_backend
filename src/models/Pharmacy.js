const mongoose = require("mongoose");

const pharmacySchema = new mongoose.Schema(
  {
    // Pharmacy identity
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Full address (when available)
    address: {
      type: String,
      default: null,
      trim: true,
    },

    // GeoJSON coordinates: [longitude, latitude]
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (coordinates) {
            return (
              coordinates.length === 2 &&
              coordinates[0] >= -180 &&
              coordinates[0] <= 180 &&
              coordinates[1] >= -90 &&
              coordinates[1] <= 90
            );
          },
          message: "Coordinates must be [longitude, latitude].",
        },
      },
    },

    // Data source
    source: {
      type: String,
      enum: ["osm", "registered"],
      default: "osm",
      required: true,
    },

    osmId: {
      type: String,
      required: true,
    },

    osmType: {
      type: String,
      enum: ["node", "way", "relation"],
      required: true,
    },

    // Regular opening schedule (OSM string, kept as reference)
    openingHours: {
      type: String,
      default: null,
      trim: true,
    },

    // Current status: true, false, or unknown
    isOpenNow: {
      type: Boolean,
      default: null,
    },

    // ── Work schedule ─────────────────────────────────────
    // Owner picks ONE mode in the popup; displayed hours follow automatically.
    // "normal"   → MON–FRI, uses weekdayOpen / weekdayClose
    // "garde"    → night duty, 20:00–08:00 (fixed hours in SCHEDULE_HOURS)
    // "dayGarde" → day duty, 08:30–20:00 (weekend / holiday)
    scheduleType: {
      type: String,
      enum: ["normal", "garde", "dayGarde"],
      default: "normal",
    },

    // Regular weekly hours — editable input (modify page + popup)
    weekdayOpen: { type: String, default: "08:30" },
    weekdayClose: { type: String, default: "19:30" },

    // Optional afternoon window (midday gap). Leave null for one continuous range.
    // e.g. morning 08:30–12:30 + afternoon 14:30–18:30
    weekdayOpen2: { type: String, default: null },
    weekdayClose2: { type: String, default: null },

    isClaimed: { type: Boolean, default: false }, // ← your existing field
    // Claim workflow: "none" = no active claim, "pending" = claim under review
    claimStatus: {
      type: String,
      enum: ["none", "pending"],
      default: "none",
    },
    phone: String,
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Last time the opening information was verified
    openingInfoVerifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Garde hours — same for every pharmacy (set by the syndicate)
pharmacySchema.statics.SCHEDULE_HOURS = {
  garde: { open: "20:00", close: "08:00" }, // night duty, crosses midnight
  dayGarde: { open: "08:30", close: "20:00" }, // day duty
};

// Required for nearby-pharmacy geospatial queries
pharmacySchema.index({ location: "2dsphere" });

// Prevent duplicate OSM pharmacies
pharmacySchema.index({ osmType: 1, osmId: 1 }, { unique: true });

module.exports = mongoose.model("Pharmacy", pharmacySchema);
