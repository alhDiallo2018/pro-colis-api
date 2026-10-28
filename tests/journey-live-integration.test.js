import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic, authHeader, cleanupUsers } from './helpers.js';

describe('GPS par véhicule et départ, jamais par numéro de ligne',()=>{
 const accounts=[],drivers=[],zones=[],ads=[];let client;
 const suffix=Date.now().toString().slice(-7);
 const fix=(overrides={})=>({enabled:true,latitude:14.7333333,longitude:-17.4123456,accuracyMeters:8,capturedAt:new Date(Date.now()-1000).toISOString(),...overrides});
 const start=(index,body=fix(),driver=drivers[index])=>request(app).post(`/api/v1/advertisements/${ads[index].id}/live`).set(authHeader(driver.token)).send(body);
 beforeAll(async()=>{
  for(let i=0;i<4;i++) {
   const r=await registerPublic(`9${i}${suffix}`,`Live ${i}`,i===3?'client':'driver');expect(r.status).toBe(201);
   const account={id:r.body.user.id,token:r.body.accessToken};accounts.push(account.id);
   if(i===3){client=account;continue;}drivers.push(account);
   await prisma.user.update({where:{id:account.id},data:{isVerified:true}});
   await prisma.vehicle.create({data:{driverId:account.id,plateNumber:`LIVE-${suffix}-${i}`,model:'Tata',type:'bus',capacity:100}});
  }
  for(const name of ['Dakar','Keur Massar']) zones.push(await prisma.zone.create({data:{name:`${name} ${suffix}`,latitude:14.7,longitude:-17.4}}));
  for(let i=0;i<4;i++) {
   const reversed=i===2, owner=drivers[i===3?0:i];
   const from=zones[reversed?1:0].id,to=zones[reversed?0:1].id;
   const r=await request(app).post('/api/v1/advertisements').set(authHeader(owner.token)).send({departureZoneId:from,arrivalZoneId:to,departureAt:new Date(Date.now()+(10+i)*60000).toISOString(),availableWeight:20,
     // Le client n'a pas à ressaisir la catégorie ; une valeur contradictoire
     // ne doit pas transformer un bus enregistré en transporteur GP.
     itinerary:{serviceType:i===0?'gp':undefined,lineNumber:'45',stops:[{zoneId:from,offsetMinutes:0},{zoneId:to,offsetMinutes:60}]}});
   expect(r.status).toBe(201);ads.push(r.body.advertisement);
  }
 });
 afterAll(async()=>{
  await prisma.advertisement.deleteMany({where:{driverId:{in:accounts}}});
  await prisma.vehicle.deleteMany({where:{driverId:{in:accounts}}});
  await prisma.zone.deleteMany({where:{id:{in:zones.map(z=>z.id)}}});
  await cleanupUsers(accounts);await prisma.$disconnect();
 });
 test('catégorie et identité reprises du profil, trois véhicules pour la même ligne',async()=>{
  expect(ads[0].itinerary.serviceType).toBe('shuttle');
  expect(new Set(ads.slice(0,3).map(a=>a.transport.vehicleId)).size).toBe(3);
  for(let i=0;i<3;i++)expect((await start(i)).status).toBe(200);
  const r=await request(app).get('/api/v1/client/journeys/live').set(authHeader(client.token)).query({lineNumber:'45'});
  expect(r.status).toBe(200);const rows=r.body.journeys.filter(j=>ads.some(a=>a.id===j.advertisementId));
  expect(rows).toHaveLength(3);expect(new Set(rows.map(j=>j.vehicleId)).size).toBe(3);
  expect(rows[0].position.longitude).toBe(-17.4123456);
  const direction=await request(app).get('/api/v1/client/journeys/live').set(authHeader(client.token)).query({pickupZoneId:zones[0].id,dropoffZoneId:zones[1].id});
  expect(direction.body.journeys.filter(j=>ads.some(a=>a.id===j.advertisementId))).toHaveLength(2);
 });
 test('session isolée, refus du deuxième départ, confidentialité et ordre GPS',async()=>{
  expect((await start(3,fix(),drivers[0])).status).toBe(409);
  expect((await start(0,fix(),drivers[1])).status).toBe(403);
  await request(app).get('/api/v1/client/journeys/live').expect(401);
  const session=await prisma.journeyLive.findUnique({where:{advertisementId:ads[0].id}});
  const path=`/api/v1/advertisements/${ads[0].id}/live`;
  await request(app).patch(path).set(authHeader(drivers[0].token)).send({...fix({latitude:14.74,capturedAt:new Date().toISOString()}),sessionId:session.id}).expect(200);
  await request(app).patch(path).set(authHeader(drivers[0].token)).send({...fix({capturedAt:new Date(Date.now()-5000).toISOString()}),sessionId:session.id}).expect(409);
  await request(app).delete(path).set(authHeader(drivers[0].token)).send({sessionId:session.id}).expect(200);
  const next=await start(3,fix(),drivers[0]);expect(next.status).toBe(200);
  await request(app).delete(path).set(authHeader(drivers[0].token)).send({sessionId:session.id}).expect(200);
  expect(await prisma.journeyLive.count({where:{id:next.body.sessionId}})).toBe(1);
  await request(app).patch(path).set(authHeader(drivers[0].token)).send({...fix(),sessionId:session.id}).expect(409);
 });
 test('une mesure ancienne disparaît ; fermeture et désactivation véhicule retirent la position',async()=>{
  await prisma.journeyLive.update({where:{advertisementId:ads[1].id},data:{capturedAt:new Date(Date.now()-61000)}});
  const stale=await request(app).get('/api/v1/client/journeys/live').set(authHeader(client.token)).query({advertisementId:ads[1].id});
  expect(stale.body.journeys).toHaveLength(0);
  expect((await start(1,fix({capturedAt:new Date(Date.now()-61000).toISOString()}))).status).toBe(422);
  await request(app).post(`/api/v1/advertisements/${ads[2].id}/close`).set(authHeader(drivers[2].token)).send({}).expect(200);
  expect(await prisma.journeyLive.count({where:{advertisementId:ads[2].id}})).toBe(0);
  await prisma.vehicle.update({where:{id:ads[3].transport.vehicleId},data:{isAvailable:false}});
  const hidden=await request(app).get('/api/v1/client/journeys/live').set(authHeader(client.token)).query({advertisementId:ads[3].id});
  expect(hidden.body.journeys).toHaveLength(0);
 });
});
