import { randomBytes } from "node:crypto";

console.log(`AUTH_SECRET=${randomBytes(48).toString("base64url")}`);
