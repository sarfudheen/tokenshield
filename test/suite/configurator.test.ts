import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('Claude Code MCP configuration (token-cache wiring)', () => {
  let tmpDir: string;
  let claudeConfigPath: string;
  let fakeOutputChannel: { appendLine: (s: string) => void; lines: string[] };

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-token-claude-config-test-'));
    claudeConfigPath = path.join(tmpDir, '.claude.json');
    const lines: string[] = [];
    fakeOutputChannel = { appendLine: (s: string) => lines.push(s), lines };
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('does nothing if ~/.claude.json does not exist (no blind file creation)', async () => {
    const { configureClaudeMcp } = require('../../src/mcp/configurator');
    await configureClaudeMcp([], fakeOutputChannel, '/ext/path', '/ws/path', claudeConfigPath);
    assert.ok(!fs.existsSync(claudeConfigPath));
  });

  test('writes token-cache under projects[wsPath].mcpServers, not a global/legacy location', async () => {
    fs.writeFileSync(claudeConfigPath, JSON.stringify({ projects: {} }), 'utf-8');
    const { configureClaudeMcp } = require('../../src/mcp/configurator');

    const wsPath = '/Users/dev/my-workspace';
    await configureClaudeMcp([], fakeOutputChannel, '/ext/path', wsPath, claudeConfigPath);

    const written = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
    const servers = written.projects[wsPath].mcpServers;
    assert.ok(servers['token-cache'], 'token-cache entry missing from project mcpServers');
    assert.strictEqual(servers['token-cache'].command, 'node');
    assert.deepStrictEqual(servers['token-cache'].args, [
      path.join('/ext/path', 'dist', 'cache-server.js'),
      wsPath,
    ]);
  });

  test('preserves unrelated top-level keys and other projects in ~/.claude.json', async () => {
    const original = {
      userID: 'abc123',
      oauthAccount: { id: 'xyz' },
      projects: {
        '/some/other/project': {
          mcpServers: { context7: { command: 'npx', args: ['-y', '@context7/mcp-server'] } },
          hasTrustDialogAccepted: true,
        },
      },
    };
    fs.writeFileSync(claudeConfigPath, JSON.stringify(original), 'utf-8');
    const { configureClaudeMcp } = require('../../src/mcp/configurator');

    await configureClaudeMcp([], fakeOutputChannel, '/ext/path', '/my/ws', claudeConfigPath);

    const written = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
    assert.strictEqual(written.userID, 'abc123');
    assert.deepStrictEqual(written.oauthAccount, { id: 'xyz' });
    assert.strictEqual(written.projects['/some/other/project'].hasTrustDialogAccepted, true);
    assert.ok(written.projects['/some/other/project'].mcpServers.context7);
    assert.ok(written.projects['/my/ws'].mcpServers['token-cache']);
  });

  test('removes stale rtk MCP entry (RTK uses hooks, not MCP)', async () => {
    fs.writeFileSync(claudeConfigPath, JSON.stringify({
      projects: { '/ws': { mcpServers: { rtk: { command: 'rtk', args: ['mcp'] } } } },
    }), 'utf-8');
    const { configureClaudeMcp } = require('../../src/mcp/configurator');

    await configureClaudeMcp([], fakeOutputChannel, '/ext/path', '/ws', claudeConfigPath);

    const written = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
    assert.ok(!('rtk' in written.projects['/ws'].mcpServers));
  });

  test('always overwrites a stale token-cache entry (versioned extension path)', async () => {
    fs.writeFileSync(claudeConfigPath, JSON.stringify({
      projects: {
        '/ws': {
          mcpServers: {
            'token-cache': { command: 'node', args: ['/old/stale/path/dist/cache-server.js', '/ws'], type: 'stdio' },
          },
        },
      },
    }), 'utf-8');
    const { configureClaudeMcp } = require('../../src/mcp/configurator');

    await configureClaudeMcp([], fakeOutputChannel, '/new/ext/path', '/ws', claudeConfigPath);

    const written = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
    assert.deepStrictEqual(written.projects['/ws'].mcpServers['token-cache'].args, [
      path.join('/new/ext/path', 'dist', 'cache-server.js'),
      '/ws',
    ]);
  });

  test('does not clobber an existing project entry when adding mcpServers for the first time', async () => {
    fs.writeFileSync(claudeConfigPath, JSON.stringify({
      projects: { '/ws': { allowedTools: ['Read'], hasTrustDialogAccepted: true } },
    }), 'utf-8');
    const { configureClaudeMcp } = require('../../src/mcp/configurator');

    await configureClaudeMcp([], fakeOutputChannel, '/ext/path', '/ws', claudeConfigPath);

    const written = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
    assert.deepStrictEqual(written.projects['/ws'].allowedTools, ['Read']);
    assert.strictEqual(written.projects['/ws'].hasTrustDialogAccepted, true);
    assert.ok(written.projects['/ws'].mcpServers['token-cache']);
  });
});
