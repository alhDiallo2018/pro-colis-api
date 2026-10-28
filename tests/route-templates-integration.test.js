import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic,authHeader,cleanupUsers } from './helpers.js';

describe('trajets habituels et publication groupée',()=>{
 const users=[],zones=[];let driver,other,client,ad,template;
 const suffix=Date.now().toString().slice(-7);
 const day=Date.now()+5*86400000;
 const post=(body,account=driver)=>request(app).post(`/api/v1/driver/route-templates/${template.id}/departures`).set(authHeader(account.token)).send(body);
 beforeAll(async()=>{
  for(const [prefix,role] of [['61','driver'],['62','driver'],['63','client']]){
   const r=await registerPublic(prefix+suffix,'Trajet habituel test',role);expect(r.status).toBe(201);
   const a={id:r.body.user.id,token:r.body.accessToken};users.push(a.id);if(!driver)driver=a;else if(!other)other=a;else client=a;
  }
  await prisma.user.update({where:{id:driver.id},data:{isVerified:true}});
  await prisma.user.update({where:{id:other.id},data:{isVerified:true}});
  await prisma.vehicle.create({data:{driverId:driver.id,plateNumber:`REPEAT-${suffix}`,model:'Tata',type:'bus',capacity:100}});
  for(const name of ['Départ','Escale','Arrivée'])zones.push(await prisma.zone.create({data:{name:`${name} ${suffix}`,latitude:14.7,longitude:-17.4}}));
  const response=await request(app).post('/api/v1/advertisements').set(authHeader(driver.token)).send({departureZoneId:zones[0].id,arrivalZoneId:zones[2].id,departureAt:new Date(Date.now()+3600000).toISOString(),availableWeight:20,proposedPrice:500,
   itinerary:{lineNumber:'45',stops:zones.map((z,i)=>({zoneId:z.id,offsetMinutes:i*5}))}});
  expect(response.status).toBe(201);ad=response.body.advertisement;
  template=await prisma.routeTemplate.findFirst({where:{driverId:driver.id}});
 });
 afterAll(async()=>{
  await prisma.advertisement.deleteMany({where:{driverId:{in:users}}});
  await prisma.vehicle.deleteMany({where:{driverId:{in:users}}});
  await prisma.zone.deleteMany({where:{id:{in:zones.map(z=>z.id)}}});
  await cleanupUsers(users);await prisma.$disconnect();
 });
 test('mémorise automatiquement et réutilise le même modèle sans le dupliquer',async()=>{
  expect(template.data.itinerary.stops).toHaveLength(3);
  expect(template.data.departureAt).toBeUndefined();
  const r=await request(app).post('/api/v1/driver/route-templates').set(authHeader(driver.token)).send({advertisementId:ad.id});
  expect(r.status).toBe(200);expect(r.body.template.id).toBe(template.id);
  expect(await prisma.routeTemplate.count({where:{driverId:driver.id}})).toBe(1);
  await request(app).get('/api/v1/driver/route-templates').set(authHeader(client.token)).expect(403);
  const hidden=await request(app).get('/api/v1/driver/route-templates').set(authHeader(other.token));expect(hidden.body.templates).toEqual([]);
  await request(app).post('/api/v1/driver/route-templates').set(authHeader(other.token)).send({advertisementId:ad.id}).expect(404);
 });
 test('50 départs alternés sont atomiques et un double clic concurrent ne les republie pas',async()=>{
  // Un modèle historique tarifé ne doit pas imposer son prix aux futurs colis.
  await prisma.routeTemplate.update({where:{id:template.id},data:{data:{...template.data,proposedPrice:500}}});
  const body={requestId:randomUUID(),departures:Array.from({length:50},(_,i)=>({departureAt:new Date(day+i*600000).toISOString(),reverse:i%2===1}))};
  const result=await Promise.all([post(body),post(body)]);
  expect(result.map(r=>r.status).sort()).toEqual([200,201]);expect(result[0].body.advertisementIds).toEqual(result[1].body.advertisementIds);
  expect(result[0].body.count).toBe(50);
  const ads=await prisma.advertisement.findMany({where:{id:{in:result[0].body.advertisementIds}},include:{offers:true,journeyLive:true},orderBy:{departureAt:'asc'}});
  expect(ads).toHaveLength(50);expect(ads[1].departureZoneId).toBe(zones[2].id);expect(ads[1].arrivalZoneId).toBe(zones[0].id);
  expect(ads.every(a=>a.proposedPrice===null)).toBe(true);
  expect(ads.every(a=>a.offers.length===0 && a.journeyLive===null && a.status==='open')).toBe(true);
  expect(new Date(ads[1].metadata.itinerary.stops[1].scheduledAt)-ads[1].departureAt).toBe(300000);
  expect((await post({...body,availableWeight:19})).status).toBe(409);
  expect((await post({...body,proposedPrice:null})).status).toBe(409);
  expect((await post({...body,requestId:randomUUID()})).status).toBe(409);
  expect((await post({...body,requestId:randomUUID()},other)).status).toBe(404);
 });
 test('un planning invalide ne laisse aucun départ partiellement créé',async()=>{
  const before=await prisma.advertisement.count({where:{driverId:driver.id}});
  const invalid={requestId:randomUUID(),departures:[{departureAt:new Date(day+86400000).toISOString()},{departureAt:new Date(day+86401000).toISOString()}]};
  expect((await post(invalid)).status).toBe(409);
  expect((await post({...invalid,departures:[{departureAt:'invalid'}]})).status).toBe(422);
  expect(await prisma.advertisement.count({where:{driverId:driver.id}})).toBe(before);
  expect(await prisma.routeScheduleBatch.count({where:{driverId:driver.id,requestId:invalid.requestId}})).toBe(0);
 });
});
