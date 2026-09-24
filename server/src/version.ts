import { readFileSync } from "fs";
import { join } from "path";

/**
 * The program's version: the one number the dashboard shows and the mobile app compares itself
 * against. It lives in package.json and nowhere else - the app's Gradle build reads the same file -
 * so the server and an app built from the same commit cannot disagree.
 *
 * Bumped deliberately, when a new version of the program ships, not on every deploy: a server-only
 * change that leaves the app untouched should not tell every operator to update their phone.
 *
 * Read from disk rather than imported, because package.json sits outside the compiler's rootDir.
 * The path resolves the same from src/ (tsx, tests) and from dist/ (production).
 */
export const APP_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
).version;
