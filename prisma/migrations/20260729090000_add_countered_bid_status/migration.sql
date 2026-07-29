-- Les offres classiques et les offres d'annonce partagent l'enum BidStatus.
-- Ce statut conserve une contre-offre active jusqu'a son acceptation ou rejet.
ALTER TYPE "BidStatus" ADD VALUE IF NOT EXISTS 'countered';
