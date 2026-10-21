// Gate: AI SLOP DETECTOR (blocking, extreme)
//   - LLM self-references and placeholder text       -> zero tolerance
//   - emoji in code (outside string literals)        -> zero tolerance
//   - cliche marketing/filler phrases in comments    -> ratcheted
//   - comment walls (>25% comment lines)             -> ratcheted
// Run with GATES_EMIT_BASELINE=1 to print baseline JSON.

import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  failBlocking,
  listTrackedFiles,
  loadGateConfig,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const config = loadGateConfig();
const { phrases, codePhrases, maxCommentRatio } = config.aiSlop;

const zeroTolerance = [];
const ratcheted = [];
const commentRatioPenalty = {};

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#');
}

const emojiCodeRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F0FF}]/u;
// Music-note symbols are functional in this codebase (subtitle processing).
const allowedSymbols = new Set(['\u266A', '\u266B', '\u266C', '\u266D', '\u266F']);
const stringLiteralRe = /"[^"]*"|'[^']*'|`[^`]*`/g;

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  const lowerLines = lines.map((l) => l.toLowerCase());

  for (let i = 0; i < lines.length; i += 1) {
    const lower = lowerLines[i];
    for (const phrase of codePhrases) {
      if (lower.includes(phrase)) {
        zeroTolerance.push(`${file}:${i + 1}: AI-generated marker/placeholder "${phrase}"`);
      }
    }
    const withoutStrings = lines[i].replace(stringLiteralRe, "''");
    const chars = [...withoutStrings].filter(
      (ch) => emojiCodeRe.test(ch) && !allowedSymbols.has(ch),
    );
    if (chars.length > 0) {
      zeroTolerance.push(`${file}:${i + 1}: emoji in code (outside string literal) (ai-slop tell)`);
    }
  }

  let commentLines = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (isCommentLine(lines[i])) {
      commentLines += 1;
      const lower = lowerLines[i];
      for (const phrase of phrases) {
        if (lower.includes(phrase)) {
          ratcheted.push(`${file}:${i + 1}: AI-slop cliche in comment: "${phrase}"`);
        }
      }
    }
  }

  if (lines.length > 0) {
    const ratioPct = (commentLines / lines.length) * 100;
    if (ratioPct > maxCommentRatio * 100) {
      commentRatioPenalty[file] = Math.ceil(ratioPct - maxCommentRatio * 100);
      ratcheted.push(
        file +
          ':1: comment ratio ' +
          ratioPct.toFixed(1) +
          '% exceeds ' +
          (maxCommentRatio * 100).toFixed(0) +
          '% limit',
      );
    }
  }
}

const slopPerFile = {};
for (const v of ratcheted) {
  const file = v.split(':')[0];
  if (v.includes('comment ratio')) continue;
  slopPerFile[file] = (slopPerFile[file] ?? 0) + 1;
}

emitBaselineIfRequested({
  'aiSlop.slop': { perFile: slopPerFile },
  'aiSlop.commentRatio': { perFile: commentRatioPenalty },
});

const ratchet = ratchetViolations('aiSlop.slop', slopPerFile, { unit: 'slop hits' });
const ratioRatchet = ratchetViolations('aiSlop.commentRatio', commentRatioPenalty, {
  unit: '% over comment-ratio limit',
});
failBlocking('AI SLOP DETECTOR', [...zeroTolerance, ...ratchet, ...ratioRatchet]);
