-- Favoris exprimes dans le referentiel courant (zones).
-- `favorite_garages` n'est pas supprimee : les clients deja publies l'utilisent
-- encore. Les lignes existantes sont reportees ici quand la zone miroir du
-- garage est connue (metadata.garageId ou placeId "garage:<id>").
CREATE TABLE "favorite_zones" (
    "user_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_zones_pkey" PRIMARY KEY ("user_id","zone_id")
);

CREATE INDEX "favorite_zones_zone_id_idx" ON "favorite_zones"("zone_id");

ALTER TABLE "favorite_zones" ADD CONSTRAINT "favorite_zones_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "favorite_zones" ADD CONSTRAINT "favorite_zones_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "favorite_zones" ("user_id", "zone_id", "created_at")
SELECT fg."user_id", z."id", fg."created_at"
FROM "favorite_garages" fg
JOIN "zones" z
  ON z."metadata" ->> 'garageId' = fg."garage_id"::text
  OR z."place_id" = 'garage:' || fg."garage_id"::text
ON CONFLICT DO NOTHING;
