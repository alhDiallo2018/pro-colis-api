import { createHash } from 'node:crypto';
import { authorizeParcelMedia, fileDigest, saveMedia } from '../reliability/media.js';
import { normalizeError } from '../../utils/errors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';

const allowedMimeTypes = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/webm']
};

function getMediaType(routeName) {
  if (routeName.includes('video')) return 'video';
  if (routeName.includes('audio')) return 'audio';
  return 'photo';
}

async function persistBase64File({ file, filename, mediaType }) {
  const uploadDir = path.resolve(env.UPLOAD_LOCAL_DIR, mediaType);
  await fs.mkdir(uploadDir, { recursive: true });

  const extension = path.extname(filename || '').toLowerCase() || '.bin';
  const safeFilename = `${randomUUID()}${extension}`;
  const diskPath = path.join(uploadDir, safeFilename);

  // Strip data URL metadata when mobile sends "data:mime/type;base64,..." payloads.
  const base64Payload = file.includes(',') ? file.split(',').pop() : file;
  await fs.writeFile(diskPath, Buffer.from(base64Payload, 'base64'));

  return `${env.PUBLIC_BASE_URL}/${env.UPLOAD_LOCAL_DIR}/${mediaType}/${safeFilename}`;
}

export async function uploadBase64(req, res) {
  let writtenPath;
  let keepFile = false;
  try {
    const mediaType = getMediaType(req.path);
    const { file, filename, parcelId } = req.body;

    if (!file) {
      return fail(res, {
        status: 422,
        message: 'Fichier manquant',
        code: 'VALIDATION_ERROR',
        details: [{ path: 'file', message: 'Required' }]
      });
    }

    await authorizeParcelMedia(req.user, parcelId);
    const url = await persistBase64File({ file, filename, mediaType });
    writtenPath = path.resolve(env.UPLOAD_LOCAL_DIR, mediaType, path.basename(new URL(url).pathname));
    const checksum = createHash('sha256').update(Buffer.from(file.includes(',') ? file.split(',').pop() : file, 'base64')).digest('hex');
    const saved = await saveMedia({ user: req.user, requestId: req.body.requestId, parcelId, mediaType, filename, url, checksum });
    keepFile = saved.url === url;

    return ok(res, {
      status: 201,
      message: 'Fichier envoye',
      data: saved
    });
  } catch (error) {
    req.log.error(
      {
        errorName: error.name,
        errorCode: error.code,
        action: 'upload.base64',
        userId: req.user?.id,
        requestId: req.requestId
      },
      'Failed to upload base64 file'
    );

    const normalized = normalizeError(error);
    return fail(res, { status: normalized?.statusCode ?? 500, code: normalized?.code ?? 'INTERNAL_ERROR', message: normalized?.publicMessage ?? 'Impossible de traiter le fichier' });
  } finally {
    if (writtenPath && !keepFile) await fs.unlink(writtenPath).catch(() => {});
  }
}

export async function uploadMultipart(req, res) {
  let keepFile = false;
  try {
    const mediaType = req.body.mediaType || 'photo';
    const baseMime = (req.file?.mimetype || '').split(';')[0].trim();
    if (!req.file || !allowedMimeTypes[mediaType]?.includes(baseMime)) {
      return fail(res, { status: 422, message: 'Type de fichier invalide', code: 'VALIDATION_ERROR' });
    }
    const { parcelId, requestId } = req.body;
    await authorizeParcelMedia(req.user, parcelId);
    const url = `${env.PUBLIC_BASE_URL}/${env.UPLOAD_LOCAL_DIR}/${req.file.filename}`;
    const saved = await saveMedia({ user: req.user, requestId, parcelId, mediaType,
      filename: req.file.originalname, url, checksum: await fileDigest(req.file.path) });
    keepFile = saved.url === url;
    return ok(res, { status: 201, message: 'Fichier envoyé', data: saved });
  } catch (error) {
    const normalized = normalizeError(error);
    req.log.error({ action: 'upload.multipart', errorName: error.name, errorCode: normalized?.code, userId: req.user?.id, requestId: req.requestId }, 'Upload failed');
    return fail(res, { status: normalized?.statusCode ?? 500, code: normalized?.code ?? 'INTERNAL_ERROR', message: normalized?.publicMessage ?? 'Impossible de traiter le fichier' });
  } finally {
    // Multer écrit avant les contrôles. Retirer les fichiers refusés et ceux
    // d'une reprise idempotente évite des pièces jointes orphelines publiques.
    if (req.file && !keepFile) await fs.unlink(req.file.path).catch(() => {});
  }
}
