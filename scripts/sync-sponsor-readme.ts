import { readFile, writeFile } from "node:fs/promises";
import { updateSponsorReadme } from "../src/lib/sponsor-readme";

const path = new URL("../README.md", import.meta.url);
const current = await readFile(path, "utf8");
const next = updateSponsorReadme(current);
if (current !== next) {
  await writeFile(path, next);
  console.log("Updated README to the active sponsor campaign.");
} else {
  console.log("README already matches the active sponsor campaign.");
}
