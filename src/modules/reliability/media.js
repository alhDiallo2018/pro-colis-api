import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { prisma } from "../../config/prisma.js";
import { ForbiddenError, NotFoundError } from "../../utils/errors.js";
import { once } from "./idempotency.js";

export async function authorizeParcelMedia(user, parcelId) {
  if (!parcelId) return;
  const parcel = await prisma.parcel.findFirst({
    where: { id: parcelId, deletedAt: null },
  });
  if (!parcel) throw new NotFoundError("Colis introuvable");
  if (
    user.id === parcel.senderId ||
    user.id === parcel.assignedDriverId ||
    user.id === parcel.createdBy ||
    user.role === "super_admin" ||
    (user.role === "admin" &&
      user.garageId &&
      user.garageId === parcel.departureGarageId)
  )
    return;
  throw new ForbiddenError("Vous ne pouvez pas joindre un fichier à ce colis");
}
export async function fileDigest(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
export async function saveMedia({
  user,
  requestId,
  parcelId,
  mediaType,
  filename,
  url,
  checksum,
}) {
  return prisma.$transaction((tx) =>
    once(
      tx,
      user.id,
      "media.upload",
      requestId,
      { parcelId: parcelId || null, mediaType, filename, checksum },
      async () => {
        const media = parcelId
          ? await tx.parcelMedia.create({
              data: { parcelId, uploadedBy: user.id, mediaType, url, filename },
            })
          : null;
        return JSON.parse(JSON.stringify({ url, media }));
      },
    ),
  );
}
