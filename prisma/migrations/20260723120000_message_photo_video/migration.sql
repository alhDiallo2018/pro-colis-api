-- Add photo & video attachment support to chat messages (support chat + negotiation).
ALTER TABLE "messages" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "messages" ADD COLUMN "video_url" TEXT;
