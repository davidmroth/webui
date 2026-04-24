import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBuildInfo } from './maintenance.ts';

async function createTempBuildDirectory() {
  return mkdtemp(join(tmpdir(), 'hermes-webui-build-info-'));
}

test('getBuildInfo prefers the git tag as the surfaced frontend version', async (t) => {
  const tempDir = await createTempBuildDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  t.mock.method(process, 'cwd', () => tempDir);

  await writeFile(
    join(tempDir, 'version.json'),
    JSON.stringify({
      frontend: '0.2.9.6',
      gitTag: 'v0.2.10',
      gitCommit: 'abc123def456',
      gitCommitShort: 'abc123d',
      gitBranch: 'main',
      buildTime: '2026-04-23T12:00:00.000Z'
    })
  );

  const build = await getBuildInfo();

  assert.equal(build.source, 'version.json');
  assert.equal(build.frontend, 'v0.2.10');
  assert.equal(build.gitTag, 'v0.2.10');
});

test('getBuildInfo falls back to the baked frontend version when no git tag exists', async (t) => {
  const tempDir = await createTempBuildDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  t.mock.method(process, 'cwd', () => tempDir);

  await writeFile(
    join(tempDir, '.build.json'),
    JSON.stringify({
      frontend: '0.2.9.6',
      gitTag: 'no-tag',
      gitCommit: 'abc123def456',
      gitCommitShort: 'abc123d',
      gitBranch: 'main',
      buildTime: '2026-04-23T12:00:00.000Z'
    })
  );

  const build = await getBuildInfo();

  assert.equal(build.source, '.build.json');
  assert.equal(build.frontend, '0.2.9.6');
  assert.equal(build.gitTag, 'no-tag');
});