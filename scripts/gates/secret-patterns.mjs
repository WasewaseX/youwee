// Gate: SECRET & CREDENTIAL PATTERN SCAN (blocking)
import { CODE_EXTENSIONS, failBlocking, listTrackedFiles, readRepoFile } from './lib/scan-util.mjs';

const patterns = [
  {
    re: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i,
    why: 'hardcoded API key literal',
  },
  {
    re: /(?:secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/i,
    why: 'hardcoded secret/token literal',
  },
  { re: /Bearer\s+[A-Za-z0-9_\-=.]{24,}/, why: 'hardcoded bearer token' },
  {
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    why: 'private key material committed',
  },
  { re: /github_pat_[A-Za-z0-9_]{20,}/, why: 'GitHub fine-grained PAT committed' },
  {
    re: /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}/,
    why: 'GitHub PAT committed',
  },
  { re: /sk-[A-Za-z0-9]{20,}/, why: 'OpenAI-style key committed' },
  { re: /AKIA[0-9A-Z]{16}/, why: 'AWS access key id committed' },
];

const allowFile = /testdata|fixtures|\.test\.|docs\//i;
const violations = [];
for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (allowFile.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const { re, why } of patterns) {
      if (re.test(lines[i])) {
        violations.push(`${file}:${i + 1}: ${why}`);
      }
    }
  }
}
failBlocking('SECRET PATTERN SCAN', violations);
