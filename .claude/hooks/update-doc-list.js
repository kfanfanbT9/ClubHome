#!/usr/bin/env node
// PostToolUse(Write) hook: docs/*.md 신규 파일이 생성되면 CLAUDE.md의
// "참조 문서 목록" 표에 자동으로 한 줄을 추가한다.
const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  if (!raw) return;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const filePath = input?.tool_input?.file_path;
  if (!filePath || !filePath.toLowerCase().endsWith('.md')) return;

  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/(^|\/)docs\/([^/]+\.md)$/i);
  if (!match) return;

  const relPath = `docs/${match[2]}`;
  const cwd = process.cwd();
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) return;

  const claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
  if (claudeMd.includes(relPath)) return; // 이미 등록됨 (중복 방지)

  let title = relPath;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim();
  } catch {
    // 파일을 읽을 수 없으면 경로를 문서명으로 사용
  }

  const lineEnding = claudeMd.includes('\r\n') ? '\r\n' : '\n';
  const newRow = `| ${title} | ${relPath} | 설명 추가 필요 |${lineEnding}`;
  const tableHeaderRegex = /(## 참조 문서 목록[\s\S]*?\|---\|---\|---\|\r?\n)/;

  if (!tableHeaderRegex.test(claudeMd)) return; // 표가 없으면 아무 것도 하지 않음

  const updated = claudeMd.replace(tableHeaderRegex, `$1${newRow}`);
  fs.writeFileSync(claudeMdPath, updated, 'utf8');
}

main();
