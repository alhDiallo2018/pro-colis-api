import request from "supertest";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { registerPublic, registerStaff, cleanupUsers } from "./helpers.js";
import { importPreview } from "../src/modules/experience/imports.js";
const actors = [];
let zone, staff, parcelId;
const call = (actor, method, url, body) =>
  request(app)
    [method](`/api/v1${url}`)
    .set("Authorization", `Bearer ${actor.token}`)
    .send(body);
const payload = () => ({
  receiverName: "Awa test",
  receiverPhone: "+221770000000",
  description: "Documents",
  weight: 2,
  departureZoneId: zone.id,
  isFreeForBidding: true,
});
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const res = await registerPublic(
      `+221${Date.now().toString().slice(-8)}${i}`,
      "Fiabilité test",
    );
    actors.push({ id: res.body.user.id, token: res.body.accessToken });
  }
  const account = await registerStaff(
    `+221${Date.now().toString().slice(-8)}8`,
    "Qualité test",
    "super_admin",
  );
  staff = { id: account.userId, token: account.accessToken };
  actors.push(staff);
  zone = await prisma.zone.create({
    data: {
      name: `Reliability ${randomUUID()}`,
      city: "Dakar",
      latitude: 14.7,
      longitude: -17.4,
    },
  });
});
afterAll(async () => {
  const ids = actors.map((a) => a.id);
  const media = await prisma.parcelMedia.findMany({
    where: { uploadedBy: { in: ids } },
  });
  for (const m of media)
    await unlink(
      path.resolve(
        env.UPLOAD_LOCAL_DIR,
        path.basename(new URL(m.url).pathname),
      ),
    ).catch(() => {});
  await prisma.supportMessage.deleteMany({ where: { userId: { in: ids } } });
  await prisma.supportTicket.deleteMany({
    where: { requesterId: { in: ids } },
  });
  await prisma.parcel.deleteMany({ where: { createdBy: { in: ids } } });
  await cleanupUsers(ids);
  await prisma.zone.delete({ where: { id: zone.id } });
  await prisma.$disconnect();
});
test("une réponse perdue puis une reprise parallèle ne crée qu’un colis", async () => {
  const body = { ...payload(), requestId: randomUUID() };
  const replies = await Promise.all([
    call(actors[0], "post", "/client/parcels/create", body),
    call(actors[0], "post", "/client/parcels/create", body),
  ]);
  expect(replies.map((r) => r.status)).toEqual([201, 201]);
  parcelId = replies[0].body.parcel.id;
  expect(replies[1].body.parcel.id).toBe(parcelId);
  expect(
    await prisma.parcel.count({ where: { createdBy: actors[0].id } }),
  ).toBe(1);
  expect(
    (
      await call(actors[0], "post", "/client/parcels/create", {
        ...body,
        weight: 3,
      })
    ).status,
  ).toBe(409);
  expect(
    (await call(actors[1], "get", `/experience/requests/${body.requestId}`))
      .body.result,
  ).toBeNull();
  expect(
    (await call(actors[0], "get", `/experience/requests/${body.requestId}`))
      .body.result.parcelId,
  ).toBe(parcelId);
});
test("un brouillon ne peut être publié deux fois, même avec des clés différentes", async () => {
  const draftId = randomUUID();
  await prisma.shipmentDraft.create({
    data: {
      id: draftId,
      userId: actors[0].id,
      label: "Awa",
      data: { receiverName: "Awa" },
    },
  });
  const replies = await Promise.all(
    [1, 2].map(() =>
      call(actors[0], "post", "/client/parcels/create", {
        ...payload(),
        sourceDraftId: draftId,
        requestId: randomUUID(),
      }),
    ),
  );
  expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    (await call(actors[0], "get", `/experience/drafts/${draftId}`)).status,
  ).toBe(409);
  expect(
    (await call(actors[0], "get", "/experience/workspace")).body.drafts[0]
      .completedParcelId,
  ).toBeTruthy();
});
test("une pièce jointe rejouée conserve son URL et reste privée au propriétaire", async () => {
  const key = randomUUID();
  const upload = (actor, data = "test-image") =>
    request(app)
      .post("/api/v1/upload")
      .set("Authorization", `Bearer ${actor.token}`)
      .field("parcelId", parcelId)
      .field("mediaType", "photo")
      .field("requestId", key)
      .attach("file", Buffer.from(data), {
        filename: "preuve.jpg",
        contentType: "image/jpeg",
      });
  const a = await upload(actors[0]);
  const b = await upload(actors[0]);
  expect([a.status, b.status]).toEqual([201, 201]);
  expect(a.body.url).toBe(b.body.url);
  expect(await prisma.parcelMedia.count({ where: { parcelId } })).toBe(1);
  expect((await upload(actors[0], "different")).status).toBe(409);
  expect((await upload(actors[1])).status).toBe(403);
});
test("carnet isolé et ajout idempotent", async () => {
  const body = {
    name: "Samba",
    phone: "+221780000000",
    requestId: randomUUID(),
  };
  const a = await call(actors[0], "post", "/experience/recipients", body),
    b = await call(actors[0], "post", "/experience/recipients", body);
  expect(a.status).toBe(200);
  expect(a.body.recipient.id).toBe(b.body.recipient.id);
  expect(
    (
      await call(
        actors[1],
        "get",
        `/experience/recipients/${a.body.recipient.id}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await call(
        actors[0],
        "get",
        `/experience/recipients/${a.body.recipient.id}`,
      )
    ).body.draft.receiverName,
  ).toBe("Samba");
});
test("import CSV/Excel vérifié, erreurs par ligne et aucune publication implicite", async () => {
  const csv =
    'nom;telephone;description;poids\nAwa;+221770000000;"Documents; originaux";1,5';
  const preview = await request(app)
    .post("/api/v1/experience/imports/preview")
    .set("Authorization", `Bearer ${actors[0].token}`)
    .attach("file", Buffer.from(csv), "colis.csv");
  expect(preview.status).toBe(200);
  expect(preview.body.drafts[0].data).toMatchObject({
    weight: 1.5,
    description: "Documents; originaux",
  });
  const invalid = await importPreview(
    Buffer.from(csv + "\nSamba;12;Documents;-1"),
    "colis.csv",
  );
  expect(invalid.drafts).toEqual([]);
  expect(invalid.errors[0].line).toBe(3);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Colis");
  sheet.addRow(["nom", "telephone", "description", "poids"]);
  sheet.addRow(["Awa", "+221770000000", "Documents", 2]);
  expect(
    (
      await importPreview(
        Buffer.from(await book.xlsx.writeBuffer()),
        "colis.xlsx",
      )
    ).drafts,
  ).toHaveLength(1);
  sheet.getCell("D2").value = { formula: "1+1", result: 2 };
  await expect(
    importPreview(Buffer.from(await book.xlsx.writeBuffer()), "colis.xlsx"),
  ).rejects.toThrow("formules");
});
test("réclamation jointe au fil et notification unique au changement de statut", async () => {
  const complaint = await call(
    actors[0],
    "post",
    `/experience/parcels/${parcelId}/complaints`,
    {
      requestId: randomUUID(),
      reason: "delay",
      message: "Une question au sujet de cette livraison.",
    },
  );
  expect(complaint.status).toBe(200);
  const ticket = complaint.body.complaint;
  const mine = await call(actors[0], "get", "/support/chat/mine");
  const id = mine.body.conversation.id;
  const thread = await call(
    actors[0],
    "get",
    `/support/chat/conversations/${id}?ticketId=${ticket.id}`,
  );
  expect(thread.body.messages).toHaveLength(1);
  expect(thread.body.messages[0].body).toContain(ticket.reference);
  expect(
    (await call(actors[1], "get", `/support/chat/conversations/${id}`)).status,
  ).toBe(403);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await call(staff, "patch", `/support-technique/tickets/${ticket.id}`, {
          status: "resolved",
        })
      ).status,
    ).toBe(200);
  expect(
    await prisma.notification.count({
      where: { userId: actors[0].id, type: "complaint_status" },
    }),
  ).toBe(1);
});
test("indicateurs limités au staff autorisé et abandon non confondu avec une réponse perdue", async () => {
  expect((await call(actors[0], "get", "/quality")).status).toBe(403);
  const attemptId = randomUUID();
  const old = new Date(Date.now() - 2 * 86400000);
  await prisma.journeyEvent.create({
    data: {
      userId: actors[0].id,
      attemptId,
      event: "creation_started",
      platform: "web",
      createdAt: old,
    },
  });
  const before = await call(staff, "get", "/quality");
  expect(before.status).toBe(200);
  await prisma.operationRequest.create({
    data: {
      actorId: actors[0].id,
      scope: "parcel.create",
      requestId: attemptId,
      fingerprint: "test",
      result: { parcelId },
    },
  });
  const after = await call(staff, "get", "/quality");
  expect(after.body.quality.creationAttempts.abandoned).toBe(
    before.body.quality.creationAttempts.abandoned - 1,
  );
});
