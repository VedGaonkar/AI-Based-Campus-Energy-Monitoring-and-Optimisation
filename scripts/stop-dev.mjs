import { readFile, writeFile } from "node:fs/promises";
let record;
try {
  record = JSON.parse(
    await readFile(
      new URL("../.local/dev-session.json", import.meta.url),
      "utf8",
    ),
  );
} catch {
  console.log(
    "No recorded owned development run. Existing services were left untouched.",
  );
  process.exit(0);
}
if (record.stoppedAt) {
  console.log(
    "Recorded development run is already stopped; existing services were left untouched.",
  );
  process.exit(0);
}
try {
  process.kill(record.pid, 0);
} catch {
  console.log(
    "Recorded development process is no longer running. Existing services were left untouched.",
  );
  process.exit(0);
}
await writeFile(
  new URL("../.local/stop-request.json", import.meta.url),
  JSON.stringify({ runId: record.runId }),
);
for (let i = 0; i < 30; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const current = JSON.parse(
    await readFile(
      new URL("../.local/dev-session.json", import.meta.url),
      "utf8",
    ),
  );
  if (current.runId !== record.runId || current.stoppedAt) {
    console.log(
      "Owned development services stopped. Reused/external services were preserved.",
    );
    process.exit(0);
  }
}
throw new Error(
  "Development process did not acknowledge stop. Inspect the recorded process state; no unrelated process was killed.",
);
