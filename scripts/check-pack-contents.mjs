import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const command =
  process.platform === "win32"
    ? ["cmd.exe", ["/d", "/s", "/c", "npm pack --dry-run --json"]]
    : ["npm", ["pack", "--dry-run", "--json"]];

const { stdout } = await execFileAsync(command[0], command[1]);

const packs = JSON.parse(stdout);
const files = packs.flatMap((pack) => pack.files ?? []);
const paths = files.map((file) => file.path);
const mapFiles = paths.filter((path) => path.endsWith(".map"));

if (mapFiles.length > 0) {
  console.error("Package contains source map files:");
  for (const path of mapFiles) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      package: packs[0]?.id,
      files: paths.length,
      sourceMaps: 0,
    },
    null,
    2,
  ),
);
