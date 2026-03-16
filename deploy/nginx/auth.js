var COOKIE_NAME = "excalidraw_auth";
var COOKIE_MAX_AGE = 86400 * 30; // 30 days
var ROOMS_FILE = "/data/rooms.json";
// SHA-256 of "Chagnon"
var ADMIN_PASSWORD_HASH = "";

function getEnv(name) {
  return process.env[name] || "";
}

function sign(value) {
  var secret = getEnv("COOKIE_SECRET");
  if (!secret) return "nosecret";
  var c = require("crypto");
  return c.createHmac("sha256", secret).update(value).digest("hex");
}

function getCookie(r, name) {
  var h = r.headersIn["Cookie"];
  if (!h) return "";
  var parts = h.split(";");
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim();
    var eq = kv.indexOf("=");
    if (eq > 0 && kv.substring(0, eq) === name) {
      return kv.substring(eq + 1);
    }
  }
  return "";
}

function checkAuth(r) {
  try {
    var token = getCookie(r, COOKIE_NAME);
    if (!token) return "";
    var dot = token.indexOf(".");
    if (dot < 0) return "";
    var payload = token.substring(0, dot);
    var sig = token.substring(dot + 1);
    if (payload === "authenticated" && sig === sign(payload)) {
      return "1";
    }
    return "";
  } catch (e) {
    return "";
  }
}

function login(r) {
  if (r.method !== "POST") {
    r.return(405);
    return;
  }
  try {
    var body = JSON.parse(r.requestText);
    var passwordHash = body.passwordHash || "";
    var expectedHash = getEnv("SITE_PASSWORD_HASH");
    if (!expectedHash) {
      r.return(500, '{"error":"no password configured"}');
      return;
    }
    if (passwordHash === expectedHash) {
      var payload = "authenticated";
      var token = payload + "." + sign(payload);
      r.headersOut["Set-Cookie"] =
        COOKIE_NAME + "=" + token +
        "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + COOKIE_MAX_AGE;
      r.headersOut["Content-Type"] = "application/json";
      r.return(200, '{"ok":true}');
    } else {
      r.return(403, '{"error":"wrong password"}');
    }
  } catch (e) {
    r.return(400, '{"error":"invalid request"}');
  }
}

function loginPage(r) {
  try {
    var fs = require("fs");
    var html = fs.readFileSync("/usr/share/nginx/auth/auth.html");
    r.headersOut["Content-Type"] = "text/html; charset=utf-8";
    r.headersOut["Cache-Control"] = "no-store";
    r.return(200, html);
  } catch (e) {
    r.return(500, "Auth page error: " + e.message);
  }
}

function roomsPage(r) {
  try {
    var fs = require("fs");
    var html = fs.readFileSync("/usr/share/nginx/auth/rooms.html");
    r.headersOut["Content-Type"] = "text/html; charset=utf-8";
    r.headersOut["Cache-Control"] = "no-store";
    r.return(200, html);
  } catch (e) {
    r.return(500, "Rooms page error: " + e.message);
  }
}

// --- Room management ---

function loadRooms() {
  var fs = require("fs");
  try {
    var data = fs.readFileSync(ROOMS_FILE);
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveRooms(rooms) {
  var fs = require("fs");
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));
}

function randomHex(len) {
  var chars = "0123456789abcdef";
  var result = "";
  for (var i = 0; i < len * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

function randomAlphaNum(len) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var result = "";
  for (var i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function getAdminHash() {
  if (!ADMIN_PASSWORD_HASH) {
    var c = require("crypto");
    ADMIN_PASSWORD_HASH = c.createHash("sha256").update("Chagnon").digest("hex");
  }
  return ADMIN_PASSWORD_HASH;
}

function roomsApi(r) {
  r.headersOut["Content-Type"] = "application/json";

  try {
    if (r.method === "GET") {
      var rooms = loadRooms();
      r.return(200, JSON.stringify(rooms));
      return;
    }

    if (r.method === "POST") {
      var body = JSON.parse(r.requestText);
      var name = (body.name || "").trim();
      if (!name || name.length > 50) {
        r.return(400, '{"error":"invalid name"}');
        return;
      }
      var rooms = loadRooms();
      var room = {
        id: randomHex(10),
        key: randomAlphaNum(22),
        name: name,
        created: new Date().toISOString()
      };
      rooms.push(room);
      saveRooms(rooms);
      r.return(200, JSON.stringify(room));
      return;
    }

    if (r.method === "DELETE") {
      var body = JSON.parse(r.requestText);
      var adminHash = body.adminPasswordHash || "";
      if (adminHash !== getAdminHash()) {
        r.return(403, '{"error":"wrong admin password"}');
        return;
      }
      var id = r.args.id;
      if (!id) {
        r.return(400, '{"error":"missing room id"}');
        return;
      }
      var rooms = loadRooms();
      var filtered = rooms.filter(function(room) { return room.id !== id; });
      if (filtered.length === rooms.length) {
        r.return(404, '{"error":"room not found"}');
        return;
      }
      saveRooms(filtered);
      r.return(200, '{"ok":true}');
      return;
    }

    r.return(405);
  } catch (e) {
    r.return(500, '{"error":"' + e.message + '"}');
  }
}

export default { checkAuth, login, loginPage, roomsPage, roomsApi };
