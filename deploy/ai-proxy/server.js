// AI Proxy: translates Excalidraw AI requests to OpenRouter API format
// Excalidraw calls /v1/ai/text-to-diagram/chat-streaming (SSE)
// and /v1/ai/diagram-to-code/generate (JSON)
// This proxy forwards them to OpenRouter's /v1/chat/completions

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3016;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DEFAULT_MODEL = process.env.AI_MODEL || "deepseek/deepseek-v3.2";
const VISION_MODEL = process.env.AI_VISION_MODEL || "google/gemini-2.0-flash-001";

const SYSTEM_PROMPT_TTD = `You are an expert at generating Mermaid diagram syntax. The user will describe a diagram and you must respond with ONLY valid Mermaid syntax. Do not include any explanation, markdown code fences, or other text. Just the raw Mermaid diagram code.`;

const SYSTEM_PROMPT_D2C = `You are an expert at converting diagram descriptions into clean, self-contained HTML. Respond with ONLY the HTML code, no explanation or markdown fences.`;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function openRouterRequest(body, stream) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: "openrouter.ai",
      path: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "HTTP-Referer": "https://draw.gaiachagnon.com",
        "X-Title": "Excalidraw AI",
      },
    };

    const req = https.request(options, (res) => resolve(res));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function handleTTDStreaming(req, res) {
  try {
    const body = await parseBody(req);
    const messages = body.messages || [];

    // Build OpenRouter request
    const openRouterBody = {
      model: DEFAULT_MODEL,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_TTD },
        ...messages,
      ],
    };

    const upstream = await openRouterRequest(openRouterBody, true);

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    let buffer = "";

    upstream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();

        if (data === "[DONE]") {
          // Send Excalidraw-format done event
          res.write(
            `data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`
          );
          res.end();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            res.write(
              `data: ${JSON.stringify({ type: "content", delta })}\n\n`
            );
          }
        } catch (e) {
          // skip unparseable chunks
        }
      }
    });

    upstream.on("end", () => {
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`
        );
        res.end();
      }
    });

    upstream.on("error", (err) => {
      res.write(
        `data: ${JSON.stringify({ type: "error", error: { message: err.message } })}\n\n`
      );
      res.end();
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleD2C(req, res) {
  try {
    const body = await parseBody(req);

    const userContent = [
      `Convert this diagram to HTML code.`,
      body.texts?.length ? `Text elements: ${body.texts.join(", ")}` : "",
      `Theme: ${body.theme || "light"}`,
    ]
      .filter(Boolean)
      .join("\n");

    const openRouterBody = {
      model: body.image ? VISION_MODEL : DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_D2C },
        {
          role: "user",
          content: body.image
            ? [
                { type: "text", text: userContent },
                {
                  type: "image_url",
                  image_url: { url: body.image },
                },
              ]
            : userContent,
        },
      ],
    };

    const upstream = await openRouterRequest(openRouterBody, false);

    let data = "";
    upstream.on("data", (chunk) => (data += chunk));
    upstream.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        const html = parsed.choices?.[0]?.message?.content || "";
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ html }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to parse response" }));
      }
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    res.end();
    return;
  }

  if (
    req.method === "POST" &&
    req.url === "/v1/ai/text-to-diagram/chat-streaming"
  ) {
    return handleTTDStreaming(req, res);
  }

  if (req.method === "POST" && req.url === "/v1/ai/diagram-to-code/generate") {
    return handleD2C(req, res);
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`AI proxy listening on port ${PORT}, text model: ${DEFAULT_MODEL}, vision model: ${VISION_MODEL}`);
});
