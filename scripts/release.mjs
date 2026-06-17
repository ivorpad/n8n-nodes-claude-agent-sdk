#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import process from 'node:process';

function runCommand(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });

  if (!allowFailure && result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const details = stderr || stdout;
    const suffix = details ? `\n${details}` : '';
    throw new Error(`Command failed: ${command} ${args.join(' ')}${suffix}`);
  }

  return result;
}

function captureCommand(command, args) {
  const result = runCommand(command, args, { capture: true });
  return (result.stdout || '').trim();
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpSemver(version, bumpType) {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`Current version is not simple semver (x.y.z): ${version}`);
  }

  if (bumpType === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (bumpType === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (bumpType === 'major') return `${parsed.major + 1}.0.0`;
  throw new Error(`Unsupported bump type: ${bumpType}`);
}

function normalizeVersion(value) {
  return value.trim().replace(/^v/, '');
}

function normalizeTag(value) {
  const cleaned = value.trim();
  if (!cleaned) return '';
  return cleaned.startsWith('v') ? cleaned : `v${cleaned}`;
}

async function askYesNo(rl, question, defaultYes = true) {
  while (true) {
    const suffix = defaultYes ? 'Y/n' : 'y/N';
    const answer = (await rl.question(`${question} [${suffix}] `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.log('Please answer y or n.');
  }
}

async function askInput(rl, question, defaultValue, validate) {
  while (true) {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    const value = answer || defaultValue || '';
    const validation = validate ? validate(value) : true;
    if (validation === true) return value;
    console.log(validation);
  }
}

async function askChoice(rl, question, choices, defaultIndex = 0) {
  console.log(question);
  choices.forEach((choice, idx) => {
    const marker = idx === defaultIndex ? '*' : ' ';
    console.log(`  ${marker} ${idx + 1}) ${choice.label}`);
  });

  while (true) {
    const answer = (await rl.question(`Select option [${defaultIndex + 1}]: `)).trim();
    if (!answer) return choices[defaultIndex].value;
    const asNumber = Number(answer);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
      return choices[asNumber - 1].value;
    }
    const matched = choices.find((choice) => choice.value === answer);
    if (matched) return matched.value;
    console.log(`Enter a number between 1 and ${choices.length}.`);
  }
}

function ensureGitTagDoesNotExist(tag) {
  const existing = captureCommand('git', ['tag', '-l', tag]);
  if (existing) {
    throw new Error(`Tag already exists: ${tag}`);
  }
}

function ensureGhAvailable() {
  const result = runCommand('gh', ['--version'], { capture: true, allowFailure: true });
  if (result.status !== 0) {
    throw new Error('GitHub CLI (gh) is required to trigger workflow_dispatch.');
  }
}

async function main() {
  const packageJsonPath = join(process.cwd(), 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('Run this script from the repository root (package.json not found).');
  }

  try {
    captureCommand('git', ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error('This script must be run inside a git repository.');
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const currentVersion = packageJson.version;
  if (!parseSemver(currentVersion)) {
    throw new Error(`package.json version must be simple semver (x.y.z). Found: ${currentVersion}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('');
    console.log('Release publisher');
    console.log('-----------------');
    console.log(`Current package version: ${currentVersion}`);

    const dirty = captureCommand('git', ['status', '--porcelain']);
    if (dirty) {
      const continueDirty = await askYesNo(
        rl,
        'Working tree has uncommitted changes. Continue anyway?',
        false,
      );
      if (!continueDirty) {
        console.log('Aborted.');
        return;
      }
    }

    const bumpPackageVersion = await askYesNo(
      rl,
      `Create a new n8n package version (current ${currentVersion})?`,
      true,
    );

    let nextVersion = currentVersion;
    if (bumpPackageVersion) {
      const bumpMode = await askChoice(
        rl,
        'Version bump type:',
        [
          { value: 'patch', label: 'patch' },
          { value: 'minor', label: 'minor' },
          { value: 'major', label: 'major' },
          { value: 'custom', label: 'custom' },
        ],
        0,
      );

      if (bumpMode === 'custom') {
        const customVersion = await askInput(
          rl,
          'New package version (x.y.z)',
          currentVersion,
          (value) => (parseSemver(normalizeVersion(value)) ? true : 'Use x.y.z format.'),
        );
        nextVersion = normalizeVersion(customVersion);
      } else {
        nextVersion = bumpSemver(currentVersion, bumpMode);
      }
    }

    const defaultReleaseTag = `v${nextVersion}`;
    const releaseTagInput = await askInput(
      rl,
      'Release tag for git + image publish',
      defaultReleaseTag,
      (value) => {
        const tag = normalizeTag(value);
        return /^v\d+\.\d+\.\d+$/.test(tag) ? true : 'Tag must look like vX.Y.Z';
      },
    );
    const releaseTag = normalizeTag(releaseTagInput);

    const commitAndTag = await askYesNo(rl, 'Create release commit and git tag?', true);
    const pushToOrigin =
      commitAndTag && (await askYesNo(rl, 'Push branch and tag to origin?', true));

    const triggerDispatch = await askYesNo(
      rl,
      'Trigger publish-images workflow_dispatch now? (tag push already triggers publish)',
      false,
    );

    if (triggerDispatch && !pushToOrigin) {
      const dispatchWithoutPush = await askYesNo(
        rl,
        'You are not pushing branch/tag. Dispatch will run on remote branch state only. Continue?',
        false,
      );
      if (!dispatchWithoutPush) {
        console.log('Aborted.');
        return;
      }
    }

    let publishBase = false;
    let publishSupport = true;
    let publishLatestAlias = false;
    let baseTag = '';
    let n8nVersion = '2.25.7';
    let claudeCodeVersion = '2.1.175';
    let puppeteerCoreVersion = '25.1.0';

    if (triggerDispatch) {
      ensureGhAvailable();
      publishBase = await askYesNo(rl, 'Publish base image?', false);
      publishSupport = await askYesNo(rl, 'Publish support images (runners + code-server)?', true);
      publishLatestAlias = await askYesNo(rl, 'Update n8n :latest alias?', false);

      if (publishBase) {
        baseTag = await askInput(rl, 'Base image tag', releaseTag, (value) =>
          value.trim() ? true : 'Base tag cannot be empty when publishing base image.',
        );
      }

      n8nVersion = await askInput(
        rl,
        'n8n runtime version',
        '2.7.3',
        (value) => (value.trim() ? true : 'Version cannot be empty.'),
      );
      claudeCodeVersion = await askInput(
        rl,
        'Claude Code CLI version',
        '2.1.170',
        (value) => (value.trim() ? true : 'Version cannot be empty.'),
      );
      puppeteerCoreVersion = await askInput(
        rl,
        'puppeteer-core version',
        'latest',
        (value) => (value.trim() ? true : 'Version cannot be empty.'),
      );
    }

    const branch = captureCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

    console.log('');
    console.log('Plan');
    console.log(`- package version: ${currentVersion} -> ${nextVersion}`);
    console.log(`- release tag: ${releaseTag}`);
    console.log(`- branch: ${branch}`);
    console.log(`- commit/tag: ${commitAndTag ? 'yes' : 'no'}`);
    console.log(`- push: ${pushToOrigin ? 'yes' : 'no'}`);
    console.log(`- workflow_dispatch: ${triggerDispatch ? 'yes' : 'no'}`);
    if (triggerDispatch) {
      console.log(`  - publish_base: ${String(publishBase)}`);
      console.log(`  - publish_release: true`);
      console.log(`  - publish_support: ${String(publishSupport)}`);
      console.log(`  - publish_latest_alias: ${String(publishLatestAlias)}`);
      if (publishBase) console.log(`  - base_tag: ${baseTag}`);
      console.log(`  - n8n_version: ${n8nVersion}`);
      console.log(`  - claude_code_version: ${claudeCodeVersion}`);
      console.log(`  - puppeteer_core_version: ${puppeteerCoreVersion}`);
    }
    console.log('');

    const proceed = await askYesNo(rl, 'Run release now?', true);
    if (!proceed) {
      console.log('Aborted.');
      return;
    }

    if (commitAndTag) {
      ensureGitTagDoesNotExist(releaseTag);
    }

    if (bumpPackageVersion) {
      runCommand('pnpm', ['version', '--no-git-tag-version', nextVersion]);
    }

    if (commitAndTag) {
      const filesToCommit = ['package.json'];
      if (existsSync(join(process.cwd(), 'pnpm-lock.yaml'))) {
        filesToCommit.push('pnpm-lock.yaml');
      }

      runCommand('git', ['add', ...filesToCommit]);

      const staged = captureCommand('git', ['diff', '--cached', '--name-only', '--', ...filesToCommit]);
      if (staged) {
        runCommand('git', ['commit', '-m', `chore(release): ${releaseTag}`, '--', ...filesToCommit]);
      } else {
        console.log('No package version file changes to commit; skipping commit.');
      }

      runCommand('git', ['tag', releaseTag]);
    }

    if (pushToOrigin) {
      runCommand('git', ['push', 'origin', branch]);
      runCommand('git', ['push', 'origin', releaseTag]);
    }

    if (triggerDispatch) {
      const workflowArgs = [
        'workflow',
        'run',
        'publish-images.yml',
        '--ref',
        branch,
        '-f',
        'publish_release=true',
        '-f',
        `publish_support=${String(publishSupport)}`,
        '-f',
        `publish_base=${String(publishBase)}`,
        '-f',
        `release_tag=${releaseTag}`,
        '-f',
        `publish_latest_alias=${String(publishLatestAlias)}`,
        '-f',
        `n8n_version=${n8nVersion}`,
        '-f',
        `claude_code_version=${claudeCodeVersion}`,
        '-f',
        `puppeteer_core_version=${puppeteerCoreVersion}`,
      ];

      if (publishBase) {
        workflowArgs.push('-f', `base_tag=${baseTag}`);
      }

      runCommand('gh', workflowArgs);
    }

    console.log('');
    console.log(`Release flow completed for ${releaseTag}.`);
    if (pushToOrigin && !triggerDispatch) {
      console.log('Tag push should trigger publish-images automatically for v* tags.');
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\nRelease failed: ${error.message}`);
  process.exit(1);
});
