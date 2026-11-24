// The Express app: one route that takes a resume and a job description, and returns
// a score plus labd's written report. Kept apart from index.js so tests can run it without a port.
import express from 'express';
import multer from 'multer';
import { analyse } from '../../zero to shipped/src/lib/analyse.js';
import { ApiError } from './errors.js';
import { extractResumeText } from './extract.js';
import { askLabd } from './labd.js';
import { buildMessages, saveReport } from './report.js';

const MIN_JOB_DESCRIPTION_LENGTH = 40;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Keep the upload in memory: the resume is read once, and nothing is written to disk but the report.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Wraps multer so its own errors (such as a file over the limit) leave as ApiErrors.
function receiveResume(req, res, next) {
  upload.single('resume')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(413, 'file_too_large', 'That file is over 10 MB. Use a smaller resume.'));
    }
    next(new ApiError(400, 'bad_upload', 'Send the resume as a file in the "resume" field.'));
  });
}

export function createApp() {
  const app = express();

  app.post('/api/analyse', receiveResume, async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(400, 'no_resume', 'Add a resume first.');

      const jobDescription = String(req.body.jobDescription ?? '').trim();
      if (jobDescription.length < MIN_JOB_DESCRIPTION_LENGTH) {
        throw new ApiError(
          400,
          'short_job_description',
          'Paste a fuller job description so there is something to compare.'
        );
      }

      const resumeText = await extractResumeText(req.file);
      if (!resumeText.trim()) {
        throw new ApiError(422, 'no_text', 'No text found. Scanned PDFs need OCR first; try a text-based file.');
      }

      const analysis = analyse(resumeText, jobDescription);
      const { content, credits } = await askLabd(
        buildMessages({ resumeText, jobDescription, analysis })
      );
      const savedAs = await saveReport({ report: content, analysis });

      res.json({ analysis, report: content, savedAs, credits });
    } catch (error) {
      next(error);
    }
  });

  // The last stop. Every error leaves as JSON with a code and a message the learner can act on.
  app.use((error, req, res, next) => {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    if (error.name === 'TimeoutError') {
      return res.status(504).json({
        code: 'timeout',
        message: 'labd took too long to answer. Try again with a shorter job description.',
      });
    }
    console.error(error);
    res.status(500).json({
      code: 'server_error',
      message: 'Something went wrong on the server. The server terminal has the details.',
    });
  });

  return app;
}
