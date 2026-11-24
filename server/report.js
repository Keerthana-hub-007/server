// Builds the request that goes to labd, and saves labd's answer as a Markdown file.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// REPORTS_DIR lets the tests write somewhere temporary. Normal use leaves it unset.
const REPORTS_DIR = process.env.REPORTS_DIR ?? fileURLToPath(new URL('./reports/', import.meta.url));

// labd accepts up to 50,000 characters per message. Stay well under that.
const MAX_RESUME_CHARS = 30_000;
const MAX_JOB_CHARS = 15_000;

export function buildMessages({ resumeText, jobDescription, analysis }) {
  const brief = [
    'Review this resume against the job description and write a short report in Markdown.',
    'Use these headings: Summary, Strengths, Gaps, Three edits.',
    'Under "Three edits", rewrite up to three resume lines so they speak to the job. Use only facts already in the resume. Never invent experience.',
    '',
    `Keyword check: score ${analysis.score} out of 100.`,
    `Matched: ${analysis.matched.join(', ') || 'none'}.`,
    `Missing: ${analysis.missing.join(', ') || 'none'}.`,
  ].join('\n');

  const content = [
    brief,
    '--- JOB DESCRIPTION ---',
    jobDescription.slice(0, MAX_JOB_CHARS),
    '--- RESUME ---',
    resumeText.slice(0, MAX_RESUME_CHARS),
  ].join('\n\n');

  return [{ role: 'user', content }];
}

// Writes the report to server/reports/ and returns the file name.
// The name is a timestamp plus a short random id, so two reports never collide.
export async function saveReport({ report, analysis }) {
  await mkdir(REPORTS_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}-${randomUUID().slice(0, 8)}.md`;
  const header = `# Resume report\n\nScore: ${analysis.score} out of 100\n\n`;

  await writeFile(path.join(REPORTS_DIR, fileName), `${header}${report}\n`, 'utf8');
  return fileName;
}
