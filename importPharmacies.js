require("dotenv").config();
const mongoose = require("mongoose");
const Pharmacy = require("./src/models/Pharmacy");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Approximate Marrakech city bounds
const BOUNDS = {
  south: 31.5,
  west: -8.1,
  north: 31.75,
  east: -7.85,
};

async function importPharmacies() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const { south, west, north, east } = BOUNDS;

    const query = `
      [out:json][timeout:60];
      nwr["amenity"="pharmacy"](
        ${south},${west},${north},${east}
      );
      out center tags;
    `;

    let elements = null;

    for (const endpoint of ENDPOINTS) {
      try {
        console.log("Trying:", endpoint);

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "MarrakechPharmacyFinder/1.0 (data import)",
            Accept: "application/json",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(70000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!Array.isArray(result.elements)) {
          throw new Error("Invalid OSM response");
        }

        elements = result.elements;
        break;
      } catch (error) {
        console.log("Request failed:", error.message);
      }
    }

    if (!elements) {
      throw new Error("All Overpass servers failed. No data was imported.");
    }

    const operations = [];

    for (const item of elements) {
      const latitude = item.lat ?? item.center?.lat;
      const longitude = item.lon ?? item.center?.lon;

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

      operations.push({
        updateOne: {
          filter: {
            osmType: item.type,
            osmId: String(item.id),
          },
          update: {
            $set: {
              name: item.tags?.name || "Unnamed pharmacy",
              location: {
                type: "Point",
                coordinates: [longitude, latitude],
              },
              source: "osm",
              osmType: item.type,
              osmId: String(item.id),
            },
          },
          upsert: true,
        },
      });
    }

    if (operations.length) {
      const result = await Pharmacy.bulkWrite(operations);
      console.log("OSM objects found:", elements.length);
      console.log("Records inserted:", result.upsertedCount);
      console.log("Records updated:", result.modifiedCount);
    } else {
      console.log("No pharmacies with usable coordinates found.");
    }
  } catch (error) {
    console.error("Import failed:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

importPharmacies();
