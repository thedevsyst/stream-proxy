# stream-proxy

Streaming proxy server for AI backends. Minimal project file so Render can detect and run the app.


Run locally:

```bash
npm install
PORT=3000 npm start
```

On Render set the start command to:

```
npm start
```

The server file is located at `server/stream-proxy.js` and listens on `process.env.PORT`.
