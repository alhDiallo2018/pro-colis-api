import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic, cleanupUsers } from './helpers.js';
import { notifyRouteAlerts } from '../src/modules/experience/alerts.service.js';

const actors=[]; const zones=[]; let parcel;
const call=(actor,method,path,body)=>request(app)[method](`/api/v1/experience${path}`).set('Authorization',`Bearer ${actor.token}`).send(body);
beforeAll(async()=>{
 for(let i=0;i<3;i++){
  const response=await registerPublic(`+221${Date.now().toString().slice(-8)}${i}`,`Experience ${i}`,i===2?'driver':'client');
  if(response.status!==201) throw new Error(JSON.stringify(response.body));
  actors.push({id:response.body.user.id, token:response.body.accessToken});
 }
 for(let i=0;i<2;i++) zones.push(await prisma.zone.create({data:{name:`UX ${randomUUID()}`,city:'Dakar',latitude:14.7,longitude:-17.4}}));
 parcel=await prisma.parcel.create({data:{trackingNumber:`UX-${randomUUID()}`,senderId:actors[0].id,senderName:'Awa',senderPhone:'+221770000000',receiverName:'Samba',receiverPhone:'+221780000000',description:'Documents',weight:2,status:'confirmed',assignedDriverId:actors[2].id,departureZoneId:zones[0].id,arrivalZoneId:zones[1].id,price:2000}});
});
afterAll(async()=>{
 const ids=actors.map(a=>a.id);
 await prisma.supportMessage.deleteMany({where:{userId:{in:ids}}});
 await prisma.supportTicket.deleteMany({where:{requesterId:{in:ids}}});
 await prisma.payment.deleteMany({where:{userId:{in:ids}}});
 if(parcel) await prisma.parcel.delete({where:{id:parcel.id}});
 await prisma.advertisement.deleteMany({where:{driverId:{in:ids}}});
 await cleanupUsers(ids);
 await prisma.zone.deleteMany({where:{id:{in:zones.map(z=>z.id)}}});
 await prisma.$disconnect();
});
test('périmètre privé, champs financiers bornés au rôle et copie sans engagement',async()=>{
 expect((await call(actors[1],'get',`/parcels/${parcel.id}`)).status).toBe(404);
 const client=await call(actors[0],'get',`/parcels/${parcel.id}`);
 expect(client.status).toBe(200);
 expect(client.body.experience.finance).not.toHaveProperty('accountCommissionDebt');
 expect((await call(actors[2],'get',`/parcels/${parcel.id}`)).body.experience.finance).toHaveProperty('accountCommissionDebt');
 expect((await call(actors[2],'get',`/parcels/${parcel.id}/repeat`)).status).toBe(403);
 const repeat=await call(actors[0],'get',`/parcels/${parcel.id}/repeat`);
 expect(repeat.body.draft).not.toHaveProperty('price');
});
test('réclamation idempotente, visible au bon utilisateur et dans les tickets support',async()=>{
 const body={requestId:randomUUID(),reason:'delay',message:'Le chauffeur ne répond pas pour la remise.'};
 const responses=await Promise.all([call(actors[0],'post',`/parcels/${parcel.id}/complaints`,body),call(actors[0],'post',`/parcels/${parcel.id}/complaints`,body)]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);
 expect(responses[0].body.complaint.id).toBe(responses[1].body.complaint.id);
 expect((await call(actors[0],'post',`/parcels/${parcel.id}/complaints`,{...body,message:'Autre description du problème.'})).status).toBe(409);
 expect((await call(actors[2],'get',`/parcels/${parcel.id}`)).body.experience.complaints).toEqual([]);
});
test('lot de brouillons atomique, rejouable et isolé par compte',async()=>{
 const id=randomUUID(); const body={drafts:[{id,label:'Boutique A',data:{receiverName:'Awa',weight:2}}]};
 expect((await call(actors[0],'post','/drafts',body)).status).toBe(200);
 expect((await call(actors[0],'post','/drafts',body)).status).toBe(200);
 expect((await call(actors[1],'get',`/drafts/${id}`)).status).toBe(404);
 expect((await call(actors[0],'get','/workspace')).body.drafts).toHaveLength(1);
 expect((await call(actors[0],'post','/drafts',{drafts:[{id:randomUUID(),label:'Interdit',data:{price:1}}]})).status).toBe(422);
});
test('alertes explicites, bon sens et absence de double notification',async()=>{
 const body={departureZoneId:zones[0].id,arrivalZoneId:zones[1].id};
 expect((await call(actors[0],'post','/alerts',body)).status).toBe(422);
 expect((await call(actors[0],'post','/alerts',{...body,consent:true})).status).toBe(200);
 const ad=await prisma.advertisement.create({data:{...body,driverId:actors[2].id,departureAt:new Date(Date.now()+86400000)}});
 await prisma.$transaction(async tx=>{await notifyRouteAlerts(tx,{...ad,departureZoneId:body.arrivalZoneId,arrivalZoneId:body.departureZoneId});});
 expect(await prisma.notification.count({where:{userId:actors[0].id,type:'route_alert'}})).toBe(0);
 await prisma.$transaction(async tx=>{await notifyRouteAlerts(tx,ad);await notifyRouteAlerts(tx,ad);});
 expect(await prisma.notification.count({where:{userId:actors[0].id,type:'route_alert'}})).toBe(1);
});
test('la commission en points conserve son montant historique et les reçus restent privés', async () => {
 await prisma.scoreTransaction.create({data:{userId:actors[2].id,parcelId:parcel.id,type:'commission_deduction',source:'driver_payment',description:'Commission de test',amount:-50,metadata:{commission:150,cfaPerPoint:3}}});
 await prisma.payment.create({data:{userId:actors[0].id,parcelId:parcel.id,amount:2000,status:'completed',method:'cash',reference:`TEST-${randomUUID()}`}});
 const driver=(await call(actors[2],'get',`/parcels/${parcel.id}`)).body.experience;
 expect(driver.finance).toMatchObject({commission:150,paidCommission:150,commissionEstimated:false,netAfterCommission:1850,collected:2000});
 expect(driver.receipts).toEqual([]);
 const client=(await call(actors[0],'get',`/parcels/${parcel.id}`)).body.experience;
 expect(client.receipts).toHaveLength(1);
 expect((await call(actors[1],'get','/workspace')).body.receipts).toHaveLength(0);
});
test('un colis historique sans compte expéditeur reste lisible par son chauffeur', async () => {
 await prisma.parcel.update({where:{id:parcel.id},data:{senderId:null}});
 const response=await call(actors[2],'get',`/parcels/${parcel.id}`);
 expect(response.status).toBe(200);
 expect(response.body.experience.receipts).toEqual([]);
 expect(response.body.experience.finance.collected).toBe(2000);
});
