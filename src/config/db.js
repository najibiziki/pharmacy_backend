const mongoose = require("mongoose");

let connectPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return; // already connected

  if (!connectPromise) {
    if (!process.env.MONGODB_URI) {
      connectPromise = Promise.reject(
        new Error("MONGODB_URI is missing from the env vars"),
      );
    } else {
      connectPromise = mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
      });
    }
  }

  return connectPromise;
}

module.exports = connectDB;
