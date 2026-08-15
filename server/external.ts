import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.join(currentDirectory, "public");

function requirePrivateAccess(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health") return next();
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return next();

  const authorization = req.headers.authorization;
  const encoded = authorization?.startsWith("Basic ") ? authorization.slice(6) : "";
  const supplied = Buffer.from(encoded, "base64").toString("utf8").split(":").slice(1).join(":");
  if (supplied === password) return next();

  res.setHeader("WWW-Authenticate", 'Basic realm="Drama Stream URL Extractor"');
  res.status(401).send("Private application access required.");
}

async function startServer() {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error("PORT must be provided by the hosting service.");
  }

  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  app.use(requirePrivateAccess);
  app.use(express.json({ limit: "50mb" }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }) => ({ req, res, user: null }),
    }),
  );
  app.use(express.static(staticDirectory, { index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(staticDirectory, "index.html")));

  server.listen(port, () => {
    console.log("External deployment server is ready.");
  });
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
