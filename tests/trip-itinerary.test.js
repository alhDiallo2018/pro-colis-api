import { normalizeItinerary, segmentFor, assertSegmentCapacity } from '../src/modules/trips/itinerary.js';
const ids = ['1','2','3','4'].map(n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`);
const start = new Date(Date.now() + 3600000).toISOString();
const source = { departureZoneId: ids[0], arrivalZoneId: ids[3], departureAt: start, availableWeight: 10 };
const input = { serviceType: 'shuttle', lineNumber: '45', stops: ids.map((zoneId, i) => ({ zoneId, offsetMinutes: i * 30 })) };
const db = { zone: { findMany: async () => ids.map((id,i) => ({id, name: ['Keur Massar','Arrêt A','Arrêt B','Parcelles'][i], latitude:14.7,longitude:-17.4})) } };
let ad;
beforeEach(async () => {ad = {...source, metadata:{itinerary:await normalizeItinerary(input,source,db)}};});
const parcel = (from,to,weight=6,id='p') => ({id,departureZoneId:ids[from],arrivalZoneId:ids[to],weight,status:'confirmed'});
test('résout les arrêts et les horaires sans faire confiance aux libellés envoyés', () => {
 expect(ad.metadata.itinerary.lineNumber).toBe('45');
 expect(ad.metadata.itinerary.stops[1].name).toBe('Arrêt A');
 expect(new Date(ad.metadata.itinerary.stops[1].scheduledAt)-new Date(start)).toBe(1800000);
});
test('valide les terminus, la ligne et la progression des horaires', async () => {
 await expect(normalizeItinerary({...input,lineNumber:''},source,db)).rejects.toThrow();
 await expect(normalizeItinerary({...input,stops:[input.stops[0],input.stops[0]]},source,db)).rejects.toThrow();
 await expect(normalizeItinerary(input,{...source,arrivalZoneId:ids[2]},db)).rejects.toThrow();
 await expect(normalizeItinerary(input,{...source,departureAt:null},db)).rejects.toThrow();
});
test('prise intermédiaire après le départ autorisée, arrêt passé et sens inverse refusés', () => {
 const now=new Date(start).getTime()+600000;
 expect(segmentFor(ad,parcel(1,3),now).from).toBe(1);
 expect(()=>segmentFor(ad,parcel(0,2),now)).toThrow();
 expect(()=>segmentFor(ad,parcel(2,1))).toThrow();
});
test('capacité par tronçon : deux colis successifs peuvent réutiliser la même place', () => {
 expect(assertSegmentCapacity(ad,parcel(1,3),[{parcel:parcel(0,1,8,'other')}])).toMatchObject({from:1,to:3});
 expect(()=>assertSegmentCapacity(ad,parcel(1,3),[{parcel:parcel(0,2,8,'other')}])).toThrow(/Capacité/);
 expect(()=>assertSegmentCapacity(ad,parcel(0,3,11),[])).toThrow(/Capacité/);
});
test('GP possède aussi un départ daté et des points de remise', async () => {
 const gp=await normalizeItinerary({...input,serviceType:'gp'},source,db);
 expect(gp.lineNumber).toBeNull();expect(gp.stops).toHaveLength(4);
});
