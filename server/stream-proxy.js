// server/stream-proxy.js
// Streaming proxy server for AI backends
// Works perfectly on Render Web Service (listens on process.env.PORT)

const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT; // ✅ Render injects this automatically

function sendNotFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS headers so frontend apps can connect
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Health check / info page
    if (req.method === "GET" && url.pathname === "/api/ai/stream") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<html><body><h3>✅ Stream endpoint is running</h3><p>POST JSON here to stream AI responses.</p></body></html>`
      );
      return;
    }

    // POST streaming endpoint
    if (req.method === "POST" && url.pathname === "/api/ai/stream") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        let payload;
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON");
          return;
        }

        console.log("Streaming request:", {
          model: payload.model,
          messages: payload.messages?.length || 0,
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");

        try {
          const servers = [
            { url: "https://text.pollinations.ai", apiKey: "" },
            {
              url: "https://api.a4f.co/v1",
              apiKey: "ddc-a4f-f8e41843d9e14d3b9fad159205b62357",
            },
          ];

          const serverIdx = payload.serverIdx || 0;
          const selectedServer = servers[serverIdx];
          if (!selectedServer) throw new Error(`Invalid server index: ${serverIdx}`);

          console.log(`Forwarding to ${selectedServer.url}`);

          // Use the global fetch available in Node >=18
          let aiResponse;

          if (serverIdx === 0) {
            aiResponse = await fetch(`${selectedServer.url}/openai`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(selectedServer.apiKey ? { Authorization: `Bearer ${selectedServer.apiKey}` } : {}),
              },
              body: JSON.stringify({ model: payload.model, messages: payload.messages }),
            });
          } else {
            aiResponse = await fetch(`${selectedServer.url}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(selectedServer.apiKey ? { Authorization: `Bearer ${selectedServer.apiKey}` } : {}),
              },
              body: JSON.stringify({ model: payload.model, messages: payload.messages }),
            });
          }

          if (!aiResponse.ok) {
            throw new Error(
              `AI server responded with ${aiResponse.status}: ${await aiResponse.text()}`
            );
          }

          const aiData = await aiResponse.json();
          const aiContent =
            aiData?.choices?.[0]?.message?.content ||
            aiData?.content ||
            "No content received";

          // Stream typewriter style
          let idx = 0;
          const interval = setInterval(() => {
            if (idx >= aiContent.length) {
              clearInterval(interval);
              res.end();
              return;
            }
            try {
              res.write(aiContent[idx]);
            } catch {
              clearInterval(interval);
            }
            idx++;
          }, 20);

          req.on("close", () => clearInterval(interval));
        } catch (err) {
          console.error("Error:", err);
          res.write(`❌ Error: ${err.message}`);
          res.end();
        }
      });
      return;
    }

    sendNotFound(res);
  } catch (err) {
    console.error("Server error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal server error");
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Stream proxy running on port ${PORT}`);
});
