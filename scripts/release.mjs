#!/usr/bin/env node
// Build a signed release APK and (optionally) publish it as a GitHub Release,
// so the APK can be installed from a link on any phone — no USB, no adb, no
// developer mode. See the "Releasing" section of the README.
//
//   node scripts/release.mjs [patch|minor|major|<x.y.z>|--no-bump] [--publish]

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYSTORE = 'release.jks';
const KEYSTORE_PROPS = 'release-keystore.properties';
const KEY_ALIAS = 'not-now';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const capture = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts }).trim();

const args = process.argv.slice(2);
const publish = args.includes('--publish');
const allowDirty = args.includes('--allow-dirty');
const bumpArg = args.find((a) => !a.startsWith('--')) ?? 'patch';
const noBump = args.includes('--no-bump');

const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const die = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

// ── 1. Signing key ───────────────────────────────────────────────────────────
// One keystore, reused forever: Android only installs an update over an app
// signed with the same key. Lose it and the only way back onto the phone is to
// uninstall (losing the blocklist and the accessibility toggle) and reinstall.
function ensureKeystore() {
  if (existsSync(join(root, KEYSTORE_PROPS)) && existsSync(join(root, KEYSTORE))) return;

  step(`Creating a release signing key (${KEYSTORE})`);
  const password = randomBytes(24).toString('base64url');
  run('keytool', [
    '-genkeypair', '-v',
    '-storetype', 'PKCS12',
    '-keystore', KEYSTORE,
    '-alias', KEY_ALIAS,
    '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000',
    '-storepass', password,
    '-keypass', password,
    '-dname', 'CN=Not Now, OU=Personal, O=Not Now, L=, S=, C=GB',
  ]);
  writeFileSync(
    join(root, KEYSTORE_PROPS),
    `storeFile=${KEYSTORE}\nstorePassword=${password}\nkeyAlias=${KEY_ALIAS}\nkeyPassword=${password}\n`
  );
  warn(
    `\n  Back up ${KEYSTORE} and ${KEYSTORE_PROPS} somewhere off this machine.\n` +
      `  They are gitignored on purpose, and they are not recoverable — without\n` +
      `  them no future build can install over the one on your phone.\n`
  );
}

// ── 2. Version ───────────────────────────────────────────────────────────────
function bumpVersion() {
  const appJsonPath = join(root, 'app.json');
  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const current = appJson.expo.version;

  if (noBump) return { version: current, versionCode: appJson.expo.android.versionCode ?? 1 };

  let version;
  if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
    version = bumpArg;
  } else {
    const [major, minor, patch] = current.split('.').map(Number);
    if (bumpArg === 'major') version = `${major + 1}.0.0`;
    else if (bumpArg === 'minor') version = `${major}.${minor + 1}.0`;
    else if (bumpArg === 'patch') version = `${major}.${minor}.${patch + 1}`;
    else die(`Unknown bump "${bumpArg}" — use patch, minor, major or an explicit x.y.z`);
  }

  // versionCode is what Android actually compares when deciding whether an APK
  // is an upgrade; it must never go backwards, so it just counts up.
  const versionCode = (appJson.expo.android.versionCode ?? 0) + 1;
  appJson.expo.version = version;
  appJson.expo.android.versionCode = versionCode;
  writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  step(`Version ${current} → ${version} (versionCode ${versionCode})`);
  return { version, versionCode };
}

// ── Go ───────────────────────────────────────────────────────────────────────
if (publish && !allowDirty) {
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty) {
    die(
      'Working tree has uncommitted changes; a published release should match a\n' +
        '  commit. Commit them first, or pass --allow-dirty.\n\n' +
        dirty
    );
  }
}

ensureKeystore();

// A failed build must not leave the version bumped: rerunning would then skip a
// version number every time a compile broke.
const versionFiles = ['app.json', 'package.json'].map((name) => ({
  path: join(root, name),
  before: readFileSync(join(root, name), 'utf8'),
}));
const restoreVersionFiles = () => {
  for (const { path, before } of versionFiles) writeFileSync(path, before);
};

const { version } = bumpVersion();

try {
  step('Applying native config (expo prebuild)');
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);

  step('Building signed release APK');
  run('./gradlew', ['assembleRelease'], { cwd: join(root, 'android') });
} catch {
  restoreVersionFiles();
  die('Build failed — the version bump has been rolled back.');
}

const built = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(built)) {
  restoreVersionFiles();
  die(`Gradle reported success but ${built} is missing`);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const apkName = `not-now-${version}.apk`;
const apk = join(root, 'dist', apkName);
copyFileSync(built, apk);
step(`APK ready: dist/${apkName}`);

if (!publish) {
  console.log(
    `\nInstall it by hand, or re-run with --publish to put it on a GitHub Release\n` +
      `you can open straight from the phone's browser.\n`
  );
  process.exit(0);
}

step(`Publishing v${version} to GitHub`);
const tag = `v${version}`;
run('git', ['add', 'app.json', 'package.json']);
// --allow-empty: with --no-bump there is nothing to commit.
run('git', ['commit', '--allow-empty', '-m', `Release ${tag}`]);
run('git', ['tag', tag]);
run('git', ['push']);
run('git', ['push', 'origin', tag]);
run('gh', ['release', 'create', tag, apk, '--title', tag, '--generate-notes']);

const repo = capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
console.log(
  `\n\x1b[1mOn your phone, open:\x1b[0m\n` +
    `  https://github.com/${repo}/releases/download/${tag}/${apkName}\n\n` +
    `Tap the downloaded file to install. Android asks once to allow your browser\n` +
    `to install unknown apps — that is a normal setting, not developer mode.\n`
);
