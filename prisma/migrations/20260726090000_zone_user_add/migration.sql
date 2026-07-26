-- Ajout de zone par un utilisateur (client / chauffeur) pendant l'enregistrement
-- d'un colis ou d'une annonce : la zone resolue depuis Google Places (ou depuis
-- la position GPS) est desormais miroitee dans `garages`, car les colis et les
-- annonces referencent `garages.id` (FK departure_garage_id / arrival_garage_id).
--
-- Pays de la zone-garage : deja saisi dans le formulaire super-admin mais
-- jusqu'ici ignore faute de colonne. Sert aussi au miroir zone -> garage.
ALTER TABLE "garages" ADD COLUMN "country" TEXT;
