// Reads the text out of an uploaded resume. Runs on the server, so it uses Node
// libraries. The browser-only reader in src/lib/extractText.js is no longer used.
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { ApiError } from './errors.js';

async function readPdf(buffer) {
  // unpdf wants a Uint8Array, not a Node Buffer. mergePages joins the pages into one string.
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function extractResumeText(file) {
  const name = file.originalname.toLowerCase();

  if (name.endsWith('.pdf')) return readPdf(file.buffer);

  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }

  throw new ApiError(
    400,
    'unsupported_file',
    'Upload a PDF or a .docx file. Old .doc files are not supported.'
  );
}
