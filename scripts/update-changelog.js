const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getArgVersion() {
  if (process.argv[2]) {
    return process.argv[2].replace(/^v/, '');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return pkg.version;
}

function getLatestTag() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (tag) return tag;
  } catch {}

  try {
    const tags = execSync('git tag -l --sort=-creatordate', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);
    return tags[0] || null;
  } catch {
    return null;
  }
}

function getCommitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  try {
    const output = execSync(`git log ${range} --no-merges --pretty=format:"%s (%h)"`, {
      encoding: 'utf8',
    }).trim();
    if (!output) return [];
    return output.split('\n').map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function categorizeCommits(commits) {
  const categories = {
    Features: [],
    Fixes: [],
    Improvements: [],
    Maintenance: [],
  };

  for (const commit of commits) {
    if (/^chore\(release\):/i.test(commit) || /^bump version/i.test(commit)) {
      continue;
    }

    if (/^feat(\(.*\))?:/i.test(commit)) {
      categories.Features.push(commit.replace(/^feat(\(.*\))?:\s*/i, ''));
    } else if (/^fix(\(.*\))?:/i.test(commit)) {
      categories.Fixes.push(commit.replace(/^fix(\(.*\))?:\s*/i, ''));
    } else if (/^(perf|refactor|docs)(\(.*\))?:/i.test(commit)) {
      categories.Improvements.push(commit.replace(/^(perf|refactor|docs)(\(.*\))?:\s*/i, ''));
    } else {
      categories.Maintenance.push(commit.replace(/^chore(\(.*\))?:\s*/i, ''));
    }
  }

  return categories;
}

function formatChangelogEntry(version, categories) {
  const date = new Date().toISOString().split('T')[0];
  let entry = `## [${version}] - ${date}\n\n`;

  let hasItems = false;
  for (const [catName, items] of Object.entries(categories)) {
    if (items.length > 0) {
      hasItems = true;
      entry += `### ${catName}\n`;
      for (const item of items) {
        entry += `- ${item}\n`;
      }
      entry += '\n';
    }
  }

  if (!hasItems) {
    entry += `### Improvements\n- Routine maintenance and internal performance updates.\n\n`;
  }

  return entry;
}

function updateChangelog() {
  const version = getArgVersion();
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(
      changelogPath,
      `# Changelog\n\nAll notable changes to the "TokenShield" extension will be documented in this file.\n\n`,
      'utf8'
    );
  }

  const content = fs.readFileSync(changelogPath, 'utf8');

  if (content.includes(`## [${version}]`)) {
    console.log(`[changelog] Changelog already contains entry for version [${version}]. Skipping update.`);
    return;
  }

  const latestTag = getLatestTag();
  console.log(`[changelog] Collecting commits since ${latestTag || 'beginning'} for version ${version}...`);
  const commits = getCommitsSince(latestTag);
  const categories = categorizeCommits(commits);
  const newEntry = formatChangelogEntry(version, categories);

  const match = content.match(/\n## \[/);
  let updatedContent;
  if (match && match.index !== undefined) {
    const insertIdx = match.index + 1;
    updatedContent = content.slice(0, insertIdx) + newEntry + content.slice(insertIdx);
  } else {
    updatedContent = content.trimEnd() + '\n\n' + newEntry;
  }

  fs.writeFileSync(changelogPath, updatedContent, 'utf8');
  console.log(`[changelog] Successfully updated CHANGELOG.md for release [${version}].`);
}

updateChangelog();
