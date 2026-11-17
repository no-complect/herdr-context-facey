import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const appHome = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
for (const name of ["gpui-kit.d.ts", "herdr.d.ts"]) {
  if (!existsSync(join(appHome, name))) {
    throw new Error(`Missing ${name} in ${appHome}. Start Herdr to generate its declarations.`);
  }
}
const temporary = mkdtempSync(join(tmpdir(), "facey-host-types-"));
try {
  const config = join(temporary, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify({
      extends: resolve(root, "tsconfig.check.json"),
      compilerOptions: {
        // Host declarations contain upstream declaration-only errors; source
        // checking still uses every real API signature, including strict nulls.
        skipLibCheck: true,
        paths: {
          "gpui-kit": [join(appHome, "gpui-kit.d.ts")],
          "gpui-base": [join(appHome, "gpui-kit.d.ts")],
          herdr: [join(appHome, "herdr.d.ts")],
        },
      },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", config],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
  if (result.error) throw result.error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
