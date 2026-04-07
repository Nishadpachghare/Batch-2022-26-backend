import { app, startServer } from "./yearbookServer.js";

// OPTIONS preflight — har route ke liye
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Origin, X-Requested-With");
  res.sendStatus(204);
});

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  startServer().catch((error) => {
    console.error("Failed to start the Yearbook API:", error);
    process.exit(1);
  });
}

export default app;