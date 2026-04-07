import { app, startServer } from "./yearbookServer.js";

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  startServer().catch((error) => {
    console.error("Failed to start the Yearbook API:", error);
    process.exit(1);
  });
}

export default app;