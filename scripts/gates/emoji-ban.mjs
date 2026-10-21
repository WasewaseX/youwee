// Gate: EMOJI IN CODE BAN (blocking, zero tolerance)
// Emoji in code prose (outside string literals) is an AI-slop tell.
// Music-note symbols are allowlisted (functional in subtitle processing).
import { CODE_EXTENSIONS, failBlocking, listTrackedFiles, readRepoFile } from './lib/scan-util.mjs';

const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F0FF}]/u;
const allowedSymbols = new Set(['\u266A', '\u266B', '\u266C', '\u266D', '\u266F']);
const stringLiteralRe = /"[^"]*"|'[^']*'|`[^`]*`/g;

const violations = [];
for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const withoutStrings = lines[i].replace(stringLiteralRe, "''");
    const chars = [...withoutStrings].filter((ch) => emojiRe.test(ch) && !allowedSymbols.has(ch));
    if (chars.length > 0) {
      violations.push(`${file}:${i + 1}: emoji in code (outside string literal) (ai-slop tell)`);
    }
  }
}
failBlocking('EMOJI IN CODE BAN', violations);
