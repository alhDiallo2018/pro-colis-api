import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers } from './helpers.js';

describe('véhicule conservé dès l’inscription',()=>{
 const users=[];const suffix=Date.now().toString().slice(-7);
 afterAll(async()=>{await prisma.vehicle.deleteMany({where:{driverId:{in:users}}});await cleanupUsers(users);await prisma.$disconnect();});
 test('la catégorie Tata et la capacité sont reprises dans le profil sans nouvelle saisie',async()=>{
  const r=await request(app).post('/api/v1/auth/register').send({phone:`83${suffix}`,fullName:'Inscription véhicule',pin:'123456',role:'driver',vehicleType:'Tata',vehiclePlate:`REG-${suffix}`,vehicleModel:'Tata',vehicleCapacity:100});
  expect(r.status).toBe(201);users.push(r.body.user.id);
  expect(r.body.user.vehicleType).toBe('bus');expect(r.body.user.vehicleCapacity).toBe(100);
  const vehicle=await request(app).get('/api/v1/driver/vehicle').set(authHeader(r.body.accessToken));
  expect(vehicle.status).toBe(200);expect(vehicle.body.vehicle.type).toBe('bus');
  expect(vehicle.body.vehicle.plateNumber).toBe(`REG-${suffix}`);
 });
 test('le profil GP ne nécessite pas de plaque de bus',async()=>{
  const r=await request(app).post('/api/v1/auth/register').send({phone:`84${suffix}`,fullName:'Inscription GP',pin:'123456',role:'driver',vehicleType:'gp',vehicleCapacity:30});
  expect(r.status).toBe(201);users.push(r.body.user.id);
  expect(r.body.user.vehicleType).toBe('gp');expect(r.body.user.vehicleCapacity).toBe(30);
 });
});
