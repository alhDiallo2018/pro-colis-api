--
-- PostgreSQL database dump
--

\restrict ExSv85CiannRSDQk82Hhbv6xMKwMFTvbOjqg9t7OEPYOh2zf2TgFTi9gAJZNCte

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: procolis
--

INSERT INTO public.messages (id, sender_id, receiver_id, parcel_id, body, audio_url, photo_url, video_url, is_read, read_at, handled_by, created_at, deleted_at, edited_at) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '77777777-7777-4777-8777-777777777773', 'Bonjour, le colis est-il deja en route ?', NULL, NULL, NULL, true, '2026-08-02 23:14:37.469+00', NULL, '2026-08-02 21:35:30.221+00', NULL, NULL);
INSERT INTO public.messages (id, sender_id, receiver_id, parcel_id, body, audio_url, photo_url, video_url, is_read, read_at, handled_by, created_at, deleted_at, edited_at) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', '77777777-7777-4777-8777-777777777773', 'Oui, je suis actuellement sur la route de Thies.', NULL, NULL, NULL, true, '2026-08-03 17:00:02.725+00', NULL, '2026-08-02 21:35:30.23+00', NULL, NULL);
INSERT INTO public.messages (id, sender_id, receiver_id, parcel_id, body, audio_url, photo_url, video_url, is_read, read_at, handled_by, created_at, deleted_at, edited_at) VALUES ('05b0d660-9d14-480f-bbd6-648218d06b64', '33333333-3333-4333-8333-333333333333', '3a3a3a3a-0000-4000-8000-000000000001', NULL, 'Hi i wanna help', NULL, NULL, NULL, true, '2026-08-04 17:35:11.518+00', NULL, '2026-08-04 17:32:46.813+00', NULL, NULL);


--
-- PostgreSQL database dump complete
--

\unrestrict ExSv85CiannRSDQk82Hhbv6xMKwMFTvbOjqg9t7OEPYOh2zf2TgFTi9gAJZNCte

