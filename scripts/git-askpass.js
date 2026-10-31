'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function normalizePath(value) {
  if (process.platform === 'win32' && /^\/[A-Za-z]\//.test(value)) {
    return value[1].toUpperCase() + ':\\' + value.slice(3).replaceAll('/', '\\');
  }
  return value;
}

const vault = normalizePath(process.env.AGENT_SECRETS_DIR || path.join(os.homedir(), '.agent-secrets'));
const file = path.join(vault, 'accounts.json');

function secureVaultFile() {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(file, 0o600); } catch { fail('凭据库权限无法收紧'); }
    return;
  }
  try {
    const { execFileSync } = require('node:child_process');
    const user = os.userInfo().username;
    execFileSync('icacls', [file, '/reset'], { stdio: 'ignore' });
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:R`, '/grant', '*S-1-5-18:F', '/grant', '*S-1-5-32-544:F'], { stdio: 'ignore' });
  } catch {
    fail('Windows ACL 无法收紧');
  }
}

const platform = process.env.AGENT_GIT_PLATFORM;
const account = process.env.AGENT_GIT_ACCOUNT;
const prompt = String(process.argv[2] || '').toLowerCase();

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

if (!platform || !account) fail('缺少凭据账号选择');
secureVaultFile();

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  fail('凭据库不可读');
}

const record = data?.platforms?.[platform]?.accounts?.[account];
if (!record || typeof record.token !== 'string' || !record.token) fail('凭据账号未配置');
if (prompt.includes('username')) process.stdout.write(account + '\n');
else process.stdout.write(record.token + '\n');
