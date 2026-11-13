import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(`${directory}/${entry.name}`)
          : `${directory}/${entry.name}`,
      ),
    )
  ).flat();
}
const paths = (
  await Promise.all(["backend", "shared", "scripts", "tests"].map(files))
)
  .flat()
  .filter((p) => p.endsWith(".js") || p.endsWith(".mjs"));
for (const path of paths) {
  const result = spawnSync(process.execPath, ["--check", path], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
console.log(
  `Syntax checks passed for ${paths.length} server/shared/script/test JavaScript files. Frontend JSX is checked by npm run build.`,
);
