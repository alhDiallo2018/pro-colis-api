-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-17 — Rôle `shuttle_operator`.
--
-- Opérateur de transport collectif (compagnie Tata/AFTU/DDD) : gère des
-- lignes régulières avec plusieurs véhicules et chauffeurs, distinct d'un
-- `driver` individuel qui conduit en propre.
--
-- Additif : la valeur est ajoutée à l'enum Postgres `UserRole`. Aucun user
-- existant n'est migré automatiquement — la promotion est gérée au cas par
-- cas par un admin.
-- ─────────────────────────────────────────────────────────────────────

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'shuttle_operator';
