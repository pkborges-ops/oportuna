import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("regressão das páginas, serviços autenticados e actions (12 cenários isolados)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/register.mjs",
      "--test",
      "tests/helpers/matching-integracao.mjs",
    ],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
