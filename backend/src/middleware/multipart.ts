import busboy from 'busboy';
import { Readable } from 'stream';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Multipart file parsing that survives Cloud Functions.
 *
 * multer can't be used here. Google's Functions Framework wraps every Cloud Function
 * with a `bodyParser.raw` that matches every content type, draining the whole request into
 * `req.rawBody` before our Express app ever runs. multer then pipes an already-ended
 * request stream into busboy, which fails with "Unexpected end of form" — surfacing as
 * an opaque 500 from the global error handler. Every upload in the app broke this way
 * once the backend moved behind `onRequest`.
 *
 * So we drive busboy ourselves and feed it the buffered body when the platform has
 * already consumed the request, falling back to the live stream where nothing has
 * (local dev and the Render deploy).
 */

/** The subset of multer's file shape the routes actually use, so `req.file` stays drop-in. */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * `req.file` is set by `singleFile` below. This augmentation replaces the one
 * `@types/multer` used to provide, so nothing depends on multer any more.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      file?: UploadedFile;
    }
  }
}

export interface SingleFileOptions {
  /** Max bytes accepted for the file. Larger uploads get a 413. */
  fileSize?: number;
  /** Return false to reject the file before it is buffered. */
  accept?: (file: { originalname: string; mimetype: string }) => boolean;
  /** Message returned (400) when `accept` rejects the file. */
  acceptError?: string;
}

/**
 * Parse a single `multipart/form-data` file field into `req.file`.
 *
 * Non-multipart requests pass straight through with no `req.file`, matching
 * `multer.single()` — routes keep their own "no file uploaded" 400.
 */
export function singleFile(fieldname: string, options: SingleFileOptions = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('multipart/')) return next();

    // A body the platform already read. Present on Cloud Functions, absent on Render/local.
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (Buffer.isBuffer(rawBody) && rawBody.length === 0) return next();

    let bb: busboy.Busboy;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { files: 1, ...(options.fileSize ? { fileSize: options.fileSize } : {}) },
      });
    } catch (err) {
      // Malformed content-type (e.g. no boundary) — not something to log as a crash.
      return res.status(400).json({ success: false, error: 'Malformed multipart request' });
    }

    const chunks: Buffer[] = [];
    let file: Omit<UploadedFile, 'buffer' | 'size'> | null = null;
    let tooLarge = false;
    let settled = false;

    /** Guards against busboy emitting both an error and a close. */
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    bb.on('file', (name, stream, info) => {
      if (name !== fieldname) return stream.resume(); // drain fields we don't want

      // busboy allows a file part with no filename; multer reports that as ''.
      const originalname = info.filename ?? '';

      if (options.accept && !options.accept({ originalname, mimetype: info.mimeType })) {
        stream.resume();
        return finish(() => res.status(400).json({
          success: false,
          error: options.acceptError || 'File type not allowed',
        }));
      }

      file = { fieldname: name, originalname, encoding: info.encoding, mimetype: info.mimeType };
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => { tooLarge = true; stream.resume(); });
    });

    bb.on('close', () => finish(() => {
      if (tooLarge) {
        const mb = Math.round((options.fileSize || 0) / (1024 * 1024));
        return res.status(413).json({
          success: false,
          error: mb ? `File is too large — the limit is ${mb}MB` : 'File is too large',
        });
      }
      if (file) {
        const buffer = Buffer.concat(chunks);
        (req as any).file = { ...file, buffer, size: buffer.length } satisfies UploadedFile;
      }
      next();
    }));

    bb.on('error', (err) => finish(() => next(err)));

    if (Buffer.isBuffer(rawBody)) Readable.from(rawBody).pipe(bb);
    else req.pipe(bb);
  };
}
