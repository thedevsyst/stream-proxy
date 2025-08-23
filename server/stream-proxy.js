// server/stream-proxy.js
// Streaming proxy server for AI backends
// Works perfectly on Render Web Service (listens on process.env.PORT)

const http = require("http");
const { URL } = require("url");
const pdf = require("pdf-parse");

const PORT = process.env.PORT || 3000; // ✅ Render injects PORT; fallback for local testing

function sendNotFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Log incoming requests for debugging (shows in Render logs)
    console.log(`[request] ${new Date().toISOString()} ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);

    // Quick health check endpoint to validate the service is reachable
    if (req.method === "GET" && url.pathname === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
      return;
    }

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

    // PDF extraction endpoint
    if (req.method === "POST" && url.pathname === "/api/extract-pdf") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { url: pdfUrl } = JSON.parse(body);
          console.log(`Extracting text from PDF: ${pdfUrl}`);
          
          // Fetch the PDF file
          const pdfResponse = await fetch(pdfUrl);
          if (!pdfResponse.ok) {
            throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
          }
          
          const pdfBuffer = await pdfResponse.arrayBuffer();
          const data = await pdf(Buffer.from(pdfBuffer));
          
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ 
            success: true, 
            text: data.text,
            pages: data.numpages,
            info: data.info
          }));
        } catch (error) {
          console.error("PDF extraction error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ 
            success: false, 
            error: error.message 
          }));
        }
      });
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
          console.log('Payload received:', {
            model: payload.model,
            messagesCount: payload.messages?.length,
            filesCount: payload.files?.length,
            hasFiles: !!payload.files
          });

          // Process messages to handle multimodal content (images)
          let processedMessages = payload.messages;
          
          // If we have files (images), we need to process the last user message
          if (payload.files && payload.files.length > 0) {
            const imageFiles = payload.files.filter(f => f.type && f.type.startsWith('image/'));
            
            if (imageFiles.length > 0) {
              // Find the last user message and convert it to multimodal format
              processedMessages = payload.messages.map((message, index) => {
                if (message.role === 'user' && index === payload.messages.length - 1) {
                  
                  // Check if content is already in multimodal format (array)
                  if (Array.isArray(message.content)) {
                    console.log('Content already in multimodal format, using as-is');
                    return message; // Already in correct format
                  }
                  
                  // Convert string content to multimodal format
                  const content = [
                    { type: "text", text: message.content }
                  ];
                  
                  // Add images
                  imageFiles.forEach(file => {
                    content.push({
                      type: "image_url",
                      image_url: {
                        url: file.url
                      }
                    });
                  });
                  
                  return {
                    ...message,
                    content: content
                  };
                }
                return message;
              });
              
              console.log('Processed multimodal message with', imageFiles.length, 'images');
            }
          }

          // Use the global fetch available in Node >=18
          let aiResponse;
          let content;

          if (serverIdx === 0) {
            // Server 1: Pollinations
            aiResponse = await fetch(`${selectedServer.url}/openai`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(selectedServer.apiKey ? { Authorization: `Bearer ${selectedServer.apiKey}` } : {}),
              },
              body: JSON.stringify({ 
                model: payload.model, 
                messages: processedMessages,
                timestamp: Date.now() // Prevent caching
              }),
            });
            
            if (!aiResponse.ok) {
              throw new Error(`Server 1 API error: ${aiResponse.status} - ${await aiResponse.text()}`);
            }
            
            const aiData = await aiResponse.json();
            content = aiData?.choices?.[0]?.message?.content || aiData?.content || "No content received";
            
          } else {
            // Server 2: A4F.co with provider fallback
            // Handle both string and array model IDs
            let modelIds;
            if (Array.isArray(payload.model)) {
              modelIds = payload.model;
            } else if (typeof payload.model === 'string') {
              // Check if the model string contains multiple providers (comma-separated)
              modelIds = payload.model.includes(',') ? payload.model.split(',').map(id => id.trim()) : [payload.model];
            } else {
              modelIds = [payload.model];
            }
            
            let lastError = null;
            let found = false;
            
            console.log(`Trying ${modelIds.length} model providers:`, modelIds);
            
            for (const modelId of modelIds) {
              try {
                console.log(`Attempting model: ${modelId}`);
                aiResponse = await fetch(`${selectedServer.url}/chat/completions`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(selectedServer.apiKey ? { Authorization: `Bearer ${selectedServer.apiKey}` } : {}),
                  },
                  body: JSON.stringify({ 
                    model: modelId, 
                    messages: processedMessages,
                    timestamp: Date.now() // Prevent caching
                  }),
                });
                
                if (aiResponse.ok) {
                  const aiData = await aiResponse.json();
                  content = aiData?.choices?.[0]?.message?.content || 
                           aiData?.choices?.[0]?.delta?.content || 
                           aiData?.choices?.[0]?.content || 
                           "No content received";
                  found = true;
                  console.log(`Successfully used model: ${modelId}`);
                  break;
                } else {
                  lastError = await aiResponse.text();
                  console.warn(`Model ${modelId} failed with status ${aiResponse.status}: ${lastError}`);
                }
              } catch (err) {
                lastError = err.message;
                console.warn(`Model ${modelId} error: ${lastError}`);
              }
            }
            
            if (!found) {
              throw new Error(`All providers failed for Server 2. Last error: ${lastError}`);
            }
          }

          // Stream typewriter style
          let idx = 0;
          const interval = setInterval(() => {
            if (idx >= content.length) {
              clearInterval(interval);
              res.end();
              return;
            }
            try {
              res.write(content[idx]);
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
