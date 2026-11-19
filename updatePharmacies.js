require("dotenv").config();
const mongoose = require("mongoose");
const Pharmacy = require("./src/models/Pharmacy");

async function updatePharmacies() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const pharmacies = await Pharmacy.find({})
      .sort({ osmId: 1 })
      .select("_id osmId location address")
      .lean();

    let updated = 0;

    for (const pharmacy of pharmacies) {
      if (!pharmacy.location?.coordinates) continue;

      const [lon, lat] = pharmacy.location.coordinates;

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=fr&addressdetails=1&lat=${lat}&lon=${lon}`,
          {
            headers: {
              "User-Agent": "PharmacyFinder/1.0",
            },
          },
        );

        if (!response.ok) {
          console.log(`Skipped ${pharmacy.osmId}: HTTP ${response.status}`);
          continue;
        }

        const data = await response.json();
        const parts = data.address || {};

        const street = [
          parts.house_number,
          parts.road || parts.pedestrian || parts.footway,
        ]
          .filter(Boolean)
          .join(" ");

        const locality =
          parts.city ||
          parts.town ||
          parts.village ||
          parts.municipality ||
          parts.suburb ||
          parts.neighbourhood;

        const address = [street, locality, parts.postcode]
          .filter(Boolean)
          .join(", ");

        if (!address) {
          console.log(`No usable address for ${pharmacy.osmId}`);
          continue;
        }

        await Pharmacy.updateOne({ _id: pharmacy._id }, { $set: { address } });

        updated++;
        console.log(`${pharmacy.osmId}: ${address}`);
      } catch (error) {
        console.error(`Failed ${pharmacy.osmId}: ${error.message}`);
      }

      // Respect Nominatim's public request limit.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }

    console.log(`Finished. Addresses updated: ${updated}`);
  } catch (error) {
    console.error("Update failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

updatePharmacies();
