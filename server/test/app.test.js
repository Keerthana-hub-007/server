// Run from the server folder with `npm test`.
// A fake labd stands in for the real one, so no key or credits are needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// These must be set before the server modules load, because labd.js reads its URL on import.
const reportsDir = await mkdtemp(path.join(os.tmpdir(), 'labd-reports-'));
process.env.REPORTS_DIR = reportsDir;
process.env.LABD_API_KEY = 'test-key';

// What the fake labd should reply with, and a record of what it was sent.
const fake = { status: 200, body: null, seen: null };
const labd = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    fake.seen = { auth: req.headers.authorization, body: JSON.parse(raw) };
    res.writeHead(fake.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fake.body));
  });
});

let app;
let baseUrl;

before(async () => {
  await new Promise((resolve) => labd.listen(0, '127.0.0.1', resolve));
  process.env.LABD_API_URL = `http://127.0.0.1:${labd.address().port}/v1/api/chat`;

  const { createApp } = await import('../app.js');
  app = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(() => {
  app.close();
  labd.close();
});

// Builds a small valid PDF containing one line of text.
// A PDF's cross-reference table lists the byte offset of every object, so the
// offsets are measured as we go rather than typed in by hand. Hand-typed offsets
// were the reason the parser rejected the first version of this fixture.
function makePdf(line) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // filled in below, because its length depends on the text
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return pdf;
}

const SAMPLE_PDF = makePdf('Jane Doe. Built React dashboards and SQL reports.');

const JOB = 'We need a developer who knows React, SQL and Docker. You will build APIs and write tests.';

function resumeForm({ jobDescription = JOB, file = SAMPLE_PDF, name = 'resume.pdf' } = {}) {
  const form = new FormData();
  form.append('resume', new Blob([file], { type: 'application/pdf' }), name);
  form.append('jobDescription', jobDescription);
  return form;
}

async function post(form) {
  const res = await fetch(`${baseUrl}/api/analyse`, { method: 'POST', body: form });
  return { status: res.status, json: await res.json() };
}

test('scores the resume, sends labd the right request, and saves the report', async () => {
  fake.status = 200;
  fake.body = {
    id: 'resp_1',
    message: { role: 'assistant', content: '## Summary\n\nA good fit.' },
    credits: { percentLeft: 62, resetsAt: '2026-12-01T00:00:00.000Z' },
  };

  const { status, json } = await post(resumeForm());

  assert.equal(status, 200);
  assert.ok(json.analysis.matched.includes('react'));
  assert.ok(json.analysis.matched.includes('sql'));
  assert.match(json.report, /A good fit/);
  assert.equal(json.credits.percentLeft, 62);

  assert.equal(fake.seen.auth, 'Bearer test-key');
  assert.equal(fake.seen.body.messages.at(-1).role, 'user');

  const saved = await readFile(path.join(reportsDir, json.savedAs), 'utf8');
  assert.match(saved, /Score: \d+ out of 100/);
  assert.match(saved, /A good fit/);
  assert.equal((await readdir(reportsDir)).includes(json.savedAs), true);
});

test('refuses to call labd when the key is missing', async () => {
  const key = process.env.LABD_API_KEY;
  delete process.env.LABD_API_KEY;
  try {
    const { status, json } = await post(resumeForm());
    assert.equal(status, 500);
    assert.equal(json.code, 'missing_key');
    assert.match(json.message, /LABD_API_KEY is not set/);
  } finally {
    process.env.LABD_API_KEY = key;
  }
});

test('accepts the hyphenated key name used in .env', async () => {
  const key = process.env.LABD_API_KEY;
  const hyphenatedKey = process.env['LABD-API-KEY'];
  delete process.env.LABD_API_KEY;
  process.env['LABD-API-KEY'] = 'test-key';
  fake.status = 200;
  fake.body = {
    message: { role: 'assistant', content: 'A report.' },
    credits: { percentLeft: 90 },
  };

  try {
    const { status } = await post(resumeForm());
    assert.equal(status, 200);
    assert.equal(fake.seen.auth, 'Bearer test-key');
  } finally {
    process.env.LABD_API_KEY = key;
    if (hyphenatedKey === undefined) delete process.env['LABD-API-KEY'];
    else process.env['LABD-API-KEY'] = hyphenatedKey;
  }
});

test('passes labd errors through with their status and code', async () => {
  fake.status = 402;
  fake.body = { code: 'no_credits', message: 'The allowance is used up.' };

  const { status, json } = await post(resumeForm());

  assert.equal(status, 402);
  assert.equal(json.code, 'no_credits');
  assert.equal(json.message, 'The allowance is used up.');
});

test('rejects a job description that is too short', async () => {
  const { status, json } = await post(resumeForm({ jobDescription: 'Too short.' }));
  assert.equal(status, 400);
  assert.equal(json.code, 'short_job_description');
});

test('rejects a file that is not a PDF or .docx', async () => {
  const { status, json } = await post(resumeForm({ name: 'resume.txt', file: 'plain text' }));
  assert.equal(status, 400);
  assert.equal(json.code, 'unsupported_file');
});
