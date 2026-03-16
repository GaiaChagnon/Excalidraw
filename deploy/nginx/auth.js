var COOKIE_NAME = "excalidraw_auth";
var COOKIE_MAX_AGE = 86400 * 30; // 30 days

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

// js_set variable: returns "1" if authenticated, "" otherwise
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

export default { checkAuth, login, loginPage };
