const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "text/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const reqPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(reqPath).replace(/^\/+/, "");
  const fullPath = path.join(ROOT, safePath);

  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=UTF-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=UTF-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`PageSpeed Tracker running on http://localhost:${PORT}`);
});
