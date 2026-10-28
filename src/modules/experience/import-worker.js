import { parentPort, workerData } from "node:worker_threads";
import { importPreview } from "./imports.js";
try {
  parentPort.postMessage({
    result: await importPreview(
      Buffer.from(workerData.buffer),
      workerData.filename,
    ),
  });
} catch (error) {
  parentPort.postMessage({
    error: error.publicMessage || "Fichier invalide ou trop volumineux",
  });
}
