// njs auth module for Excalidraw password gate

var COOKIE_NAME = "excalidraw_auth";
var COOKIE_MAX_AGE = 86400 * 30; // 30 days

function getEnv(name) {
  return process.env[name] || "";
}

// HMAC-like signature using njs crypto
function sign(value) {
  var secret = getEnv("COOKIE_SECRET");
  var crypto = require("crypto");
  var hmac = crypto.createHmac("sha256", secret);
  hmac.update(value);
  return hmac.digest("hex");
}

function makeToken() {
  var payload = "authenticated";
  var sig = sign(payload);
  return payload + "." + sig;
}

function verifyToken(token) {
  if (!token) return false;
  var parts = token.split(".");
  if (parts.length !== 2) return false;
  var payload = parts[0];
  var sig = parts[1];
  return payload === "authenticated" && sig === sign(payload);
}

function getCookie(r, name) {
  var cookies = r.headersIn["Cookie"];
  if (!cookies) return null;
  var parts = cookies.split(";");
  for (var i = 0; i < parts.length; i++) {
    var pair = parts[i].trim().split("=");
    if (pair[0] === name) {
      return pair.slice(1).join("=");
    }
  }
  return null;
}

// auth_request handler: returns 200 if authenticated, 401 otherwise
function verify(r) {
  var token = getCookie(r, COOKIE_NAME);
  if (verifyToken(token)) {
    r.return(200);
  } else {
    r.return(401);
  }
}

// POST /__auth/verify — check password, set cookie
function login(r) {
  if (r.method !== "POST") {
    r.return(405);
    return;
  }

  var body;
  try {
    body = JSON.parse(r.requestText);
  } catch (e) {
    r.return(400, JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  var passwordHash = body.passwordHash;
  var expectedHash = getEnv("SITE_PASSWORD_HASH");

  if (!passwordHash || !expectedHash) {
    r.return(500, JSON.stringify({ error: "Configuration error" }));
    return;
  }

  if (passwordHash === expectedHash) {
    var token = makeToken();
    r.headersOut["Set-Cookie"] =
      COOKIE_NAME +
      "=" +
      token +
      "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
      COOKIE_MAX_AGE;
    r.headersOut["Content-Type"] = "application/json";
    r.return(200, JSON.stringify({ ok: true }));
  } else {
    r.return(403, JSON.stringify({ error: "Wrong password" }));
  }
}

// GET /__auth — serve the login page
function loginPage(r) {
  var fs = require("fs");
  try {
    var html = fs.readFileSync("/usr/share/nginx/auth/auth.html", "utf8");
    r.headersOut["Content-Type"] = "text/html; charset=utf-8";
    r.headersOut["Cache-Control"] = "no-store";
    r.return(200, html);
  } catch (e) {
    r.return(500, "Auth page not found");
  }
}

export default { verify, login, loginPage };
