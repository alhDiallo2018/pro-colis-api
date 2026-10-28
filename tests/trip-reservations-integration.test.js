import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic, authHeader, cleanupUsers } from './helpers.js';

describe('navette : réservation réelle par tronçon', () => {
 const users=[],zones=[],parcels=[];let driver,client,ad;
 const suffix=Date.now().toString().slice(-7);
 beforeAll(async()=>{
  for(const [prefix,role] of [['91','driver'],['92','client']]) {
   const r=await registerPublic(prefix+suffix,'Trajet test',role);expect(r.status).toBe(201);
   users.push(r.body.user.id);const a={id:r.body.user.id,token:r.body.accessToken};if(role==='driver') driver=a;else client=a;
  }
  await prisma.user.update({where:{id:driver.id},data:{isVerified:true}});
  await prisma.vehicle.create({data:{driverId:driver.id,plateNumber:`NAVETTE-${suffix}`,model:'Tata',type:'bus',capacity:100}});
  for(const name of ['Keur Massar','Arrêt intermédiaire','Parcelles']) zones.push(await prisma.zone.create({data:{name:`${name} ${suffix}`,latitude:14.7,longitude:-17.4}}));
  const r=await request(app).post('/api/v1/advertisements').set(authHeader(driver.token)).send({
   departureZoneId:zones[0].id,arrivalZoneId:zones[2].id,departureAt:new Date(Date.now()+3600000).toISOString(),availableWeight:10,
   itinerary:{serviceType:'shuttle',lineNumber:'45',stops:zones.map((z,i)=>({zoneId:z.id,offsetMinutes:i*30}))}
  });expect(r.status).toBe(201);ad=r.body.advertisement;
 });
 afterAll(async()=>{
  await prisma.notification.deleteMany({where:{userId:{in:users}}});
  await prisma.advertisement.deleteMany({where:{driverId:driver?.id}});
  await prisma.parcelEvent.deleteMany({where:{parcelId:{in:parcels}}});
  await prisma.parcel.deleteMany({where:{id:{in:parcels}}});
  await prisma.zone.deleteMany({where:{id:{in:zones.map(z=>z.id)}}});
  await prisma.vehicle.deleteMany({where:{driverId:driver?.id}});
  await cleanupUsers(users);await prisma.$disconnect();
 });
 async function offer(from,to,weight) {
  const p=await prisma.parcel.create({data:{trackingNumber:`TRIP-${suffix}-${parcels.length}`,senderId:client.id,description:'Colis test tronçon',senderName:'Client',senderPhone:'770000000',receiverName:'Destinataire',receiverPhone:'780000000',weight,departureZoneId:zones[from].id,arrivalZoneId:zones[to].id,status:'free',createdBy:client.id}});parcels.push(p.id);
  const r=await request(app).post(`/api/v1/advertisements/${ad.id}/offers`).set(authHeader(client.token)).send({parcelId:p.id,price:1000});
  return r;
 }
 const accept=o=>request(app).post(`/api/v1/advertisements/${ad.id}/offers/${o.id}/accept`).set(authHeader(driver.token));
 test('le client retrouve la ligne par arrêt intermédiaire, pas seulement par terminus',async()=>{
  const r=await request(app).get('/api/v1/advertisements').query({pickupZoneId:zones[1].id,dropoffZoneId:zones[2].id,serviceType:'shuttle',lineNumber:'45',weight:6});
  expect(r.status).toBe(200);expect(r.body.advertisements.find(a=>a.id===ad.id).matchingSegment.from).toBe(1);
  expect((await offer(2,0,2)).status).toBe(409);
 });
 test('deux acceptations concurrentes ne surchargent pas le même tronçon',async()=>{
  const one=await offer(0,1,6),two=await offer(0,1,6);
  expect(one.status).toBe(201);expect(two.status).toBe(201);
  const results=await Promise.all([accept(one.body.offer),accept(two.body.offer)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const accepted=results.find(r=>r.status===200);
  expect((await accept(accepted.body.offer)).status).toBe(200);
  const event=await prisma.parcelEvent.findFirst({where:{parcelId:accepted.body.parcel.id,status:'confirmed'}});
  expect(event.metadata.journeySegment.pickup.zoneId).toBe(zones[0].id);
  const onward=await offer(1,2,10);expect(onward.status).toBe(201);
  expect((await accept(onward.body.offer)).status).toBe(200);
  const changed=await request(app).put(`/api/v1/advertisements/${ad.id}`).set(authHeader(driver.token)).send({availableWeight:1});
  expect(changed.status).toBe(409);
  const full=await request(app).get('/api/v1/advertisements').query({pickupZoneId:zones[1].id,dropoffZoneId:zones[2].id,weight:1});
  expect(full.body.advertisements.some(a=>a.id===ad.id)).toBe(false);
 });
});
