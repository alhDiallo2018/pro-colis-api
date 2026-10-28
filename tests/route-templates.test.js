import { templateData, reversedRoute, expandDepartures, assertNoOverlaps } from '../src/modules/trips/templates.service.js';
const route={serviceType:'shuttle',lineNumber:'45',stops:[{zoneId:'a',name:'Dakar',offsetMinutes:0},{zoneId:'b',name:'Arrêt',offsetMinutes:4},{zoneId:'c',name:'Keur Massar',offsetMinutes:10}]};
const ad={departureZoneId:'a',arrivalZoneId:'c',availableWeight:10,proposedPrice:500,metadata:{itinerary:route,liveSecret:'not-a-template'},departureAt:new Date(),offers:[{id:'private'}]};
test('le trajet habituel ne conserve ni départ, ni offre, ni GPS',()=>{
 const data=templateData(ad);expect(data.itinerary.stops).toHaveLength(3);
 expect(data.proposedPrice).toBeNull();
 expect(data.departureAt).toBeUndefined();expect(data.offers).toBeUndefined();expect(JSON.stringify(data)).not.toContain('liveSecret');
});
test('le retour inverse les arrêts et recalcule les durées',()=>{
 const reverse=reversedRoute(route);expect(reverse.stops.map(s=>s.zoneId)).toEqual(['c','b','a']);
 expect(reverse.stops.map(s=>s.offsetMinutes)).toEqual([0,6,10]);expect(route.stops[0].zoneId).toBe('a');
});
test('50 départs ont leurs dates distinctes et ne se chevauchent pas',()=>{
 const first=Date.now()+86400000;
 const plans=expandDepartures(templateData(ad),Array.from({length:50},(_,i)=>({departureAt:new Date(first+i*600000),reverse:i%2===1})),10,500);
 expect(plans).toHaveLength(50);expect(new Set(plans.map(p=>p.departureAt.getTime())).size).toBe(50);
 expect(plans[1].departureZoneId).toBe('c');expect(()=>assertNoOverlaps(plans)).not.toThrow();
 plans[1].departureAt=new Date(first+1000);expect(()=>assertNoOverlaps(plans)).toThrow(/chevauchent/);
});
