// CommonJS wrapper for Passenger: dynamically imports the ESM server entry.
(async () => {
  await import("./server.js");
})();
