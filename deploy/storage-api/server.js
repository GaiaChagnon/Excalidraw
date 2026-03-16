// Storage API: persists encrypted scene data and binary image files to disk
// Replaces Firebase Firestore + Firebase Storage with local file storage

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3017;
const DATA_DIR = process.env.DATA_DIR || "/data";
const SCENES_DIR = path.join(DATA_DIR, "scenes");
const FILES_DIR = path.join(DATA_DIR, "files");

// Ensure base directories exist
fs.mkdirSync(SCENES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

function parseBody(req, { raw = false, maxBytes = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      if (raw) {
        resolve(buffer);
      } else {
        try {
          resolve(JSON.parse(buffer.toString("utf-8")));
        } catch (e) {
          reject(new Error("Invalid JSON"));
        }
      }
    });

    req.on("error", reject);
  });
}

// Simple file-based locking to prevent concurrent writes to the same scene
const locks = new Map();

async function withLock(key, fn) {
  while (locks.has(key)) {
    await locks.get(key);
  }
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  locks.set(key, promise);
  try {
    return await fn();
  } finally {
    locks.delete(key);
    resolve();
  }
}

// Sanitize path components to prevent directory traversal
function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

async function handleGetScene(req, res, roomId) {
  const filePath = path.join(SCENES_DIR, `${sanitize(roomId)}.json`);

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } else {
      console.error("Error reading scene:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}

async function handlePutScene(req, res, roomId) {
  try {
    const body = await parseBody(req);
    const sanitizedId = sanitize(roomId);
    const filePath = path.join(SCENES_DIR, `${sanitizedId}.json`);

    await withLock(sanitizedId, async () => {
      // Atomic write: write to temp file then rename
      const tmpPath = filePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(body));
      fs.renameSync(tmpPath, filePath);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("Error writing scene:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleGetFile(req, res, prefix, fileId) {
  const filePath = path.join(FILES_DIR, sanitize(prefix), sanitize(fileId));

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } else {
      console.error("Error reading file:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}

async function handlePutFile(req, res, prefix, fileId) {
  try {
    const buffer = await parseBody(req, { raw: true });
    const dir = path.join(FILES_DIR, sanitize(prefix));
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, sanitize(fileId));
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, filePath);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("Error writing file:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  // Don't decode full pathname before matching — encoded slashes (%2F)
  // in the prefix would break the regex. Decode matched groups instead.
  const pathname = url.pathname;

  // Route: /v1/storage/scenes/:roomId
  const sceneMatch = pathname.match(/^\/v1\/storage\/scenes\/([^/]+)$/);
  if (sceneMatch) {
    const roomId = decodeURIComponent(sceneMatch[1]);
    if (req.method === "GET") {
      return handleGetScene(req, res, roomId);
    }
    if (req.method === "PUT") {
      return handlePutScene(req, res, roomId);
    }
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  // Route: /v1/storage/files/:prefix/:fileId
  // The prefix may contain encoded slashes (e.g., files%2Frooms%2FroomId)
  const fileMatch = pathname.match(/^\/v1\/storage\/files\/([^/]+)\/([^/]+)$/);
  if (fileMatch) {
    const prefix = decodeURIComponent(fileMatch[1]);
    const fileId = decodeURIComponent(fileMatch[2]);
    if (req.method === "GET") {
      return handleGetFile(req, res, prefix, fileId);
    }
    if (req.method === "PUT") {
      return handlePutFile(req, res, prefix, fileId);
    }
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  // Health check
  if ((pathname === "/health" || pathname === "/v1/storage/health") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Storage API listening on port ${PORT}, data dir: ${DATA_DIR}`);
});
