--
-- PostgreSQL database dump
--

\restrict hPQWxF7QuWb5W3eJlYkxhQZrXFAli9X9dP40NP0wxjptThvRi8tGniuRh88RU24

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
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: procolis
--

INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('3a3a3a3a-0000-4000-8000-000000000002', 'support.com@procolis.test', '+221770000502', 'Seydou Kane', '$2a$12$CRqWTfRUadgx8scuieb5QOairoLtpNXKnqA6y3./XUXdWa0bVsJDi', '$2a$12$nV3fOfc/1rE/2ux5ZXL3eu7Lui4gebiJThIRtfgnGrKk9boeDm.c6', 'support_commercial', 'active', NULL, 'Almadies', 'Dakar', 'Dakar', NULL, NULL, NULL, 0.00, 0, 0, 0, true, true, true, true, NULL, '2026-08-04 17:35:57.304+00', '2026-08-04 17:35:57.304+00', NULL, '2026-08-04 16:54:58.93+00', '2026-08-04 17:35:57.305+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('3a3a3a3a-0000-4000-8000-000000000001', 'support.tech@procolis.test', '+221770000501', 'Awa Ndoye', '$2a$12$b/yXKBgDebSgZwT4N6gfAuD6VtBcOrsHRbmfCw8d.DnLvhDPA7GDS', '$2a$12$3VtSe9F2xbTpBv2vRXPUgeLpG1Gu6XK3x.PNitqibe7uddvYWcM5K', 'support_technique', 'active', NULL, 'Point E', 'Dakar', 'Dakar', NULL, NULL, NULL, 0.00, 0, 0, 0, true, true, true, true, NULL, '2026-08-04 17:39:40.013+00', '2026-08-04 17:39:40.013+00', NULL, '2026-08-04 16:54:58.004+00', '2026-08-04 17:39:40.015+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('7de18727-3693-491f-89d9-f3f55a7c6324', 'abdou@gmail.com', '+221770000102', 'Abdou', NULL, '$2a$12$t0cA3pK9zS4uZevFnZkPpe41RS6dt4ljKqPNqAm6bbci.OjmRhvJu', 'support_technique', 'active', NULL, NULL, 'dakar', 'YEUMBEUL', NULL, NULL, NULL, 0.00, 0, 0, 0, false, false, false, true, NULL, '2026-08-04 18:16:39.466+00', '2026-08-04 18:16:39.466+00', NULL, '2026-08-04 17:00:27.93+00', '2026-08-04 18:16:39.467+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333334', 'admin@procolis.test', '+221770000303', 'Super Admin', '$2a$12$78lkgsf7t24wfMkxXYqq/uamlf7sDqHKyBVEQWMufnrfNwjGHFbOy', '$2a$12$0IQxrd1Etx3nrrQlAAwDVOSLucfzpiozwKy96wsZzYGHcDrp2tv26', 'super_admin', 'active', NULL, 'Centre-ville', 'Dakar', 'Dakar', NULL, NULL, NULL, 0.00, 0, 0, 0, true, true, false, true, NULL, '2026-08-04 16:59:16.601+00', '2026-08-04 16:59:16.601+00', NULL, '2026-08-02 21:35:29.226+00', '2026-08-04 16:59:16.603+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333335', 'garage@procolis.test', '+221770000404', 'Admin Garage Dakar', '$2a$12$Gu8O4WRD/1wiMxCXkoin1eMmgRUbsi3uKeKb2U7E9y3q.harX/z3.', '$2a$12$4rzD/PBKYOmXeKHs/CqsVO0gCHUd7rkb/cvvtHA8uJmXNieuyjdfS', 'admin', 'active', NULL, 'Route de Rufisque', 'Dakar', 'Dakar', NULL, '11111111-1111-4111-8111-111111111111', NULL, 0.00, 0, 0, 0, true, true, false, true, NULL, NULL, NULL, NULL, '2026-08-02 21:35:30.015+00', '2026-08-02 23:14:37.351+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('cc5e84b6-c08c-4357-b22c-d07c0745345d', 'mame@gmail.com', '+221770000103', 'MAME FATOU', NULL, '$2a$12$rjqng6Xk42W7OlYJzzpg5uLQdeRyn2c.vahDWfa5k3OkCbg4wVKEe', 'support_commercial', 'active', NULL, NULL, 'dakar', 'PIKINE', NULL, NULL, NULL, 0.00, 0, 0, 0, false, false, false, true, NULL, '2026-08-04 17:01:54.17+00', '2026-08-04 17:01:54.17+00', NULL, '2026-08-04 17:01:25.471+00', '2026-08-04 17:01:54.171+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('44444444-4444-4444-8444-444444444444', 'driver@procolis.test', '+221770000202', 'Driver Test', '$2a$12$RtHXGiuAEEVXk8ZeYR9Eieqcy4MatEBwq1bS1WAtV.soN71Mw9EbG', '$2a$12$XqO0oYILJTgAjY1YN7QucOB2yEzNuipiazTCdqOyvjNvgrVAU6sve', 'driver', 'active', NULL, 'Medina', 'Dakar', 'Dakar', NULL, '11111111-1111-4111-8111-111111111111', 'available', 0.00, 0, 0, 0, true, true, false, true, NULL, '2026-08-03 17:21:14.17+00', '2026-08-03 17:21:14.17+00', NULL, '2026-08-02 21:35:28.428+00', '2026-08-03 17:21:14.172+00');
INSERT INTO public.users (id, email, phone, full_name, password_hash, pin_hash, role, status, profile_photo, address, city, region, gender, garage_id, driver_status, rating, total_deliveries, completed_deliveries, cancelled_deliveries, is_email_verified, is_phone_verified, is_verified, is_profile_complete, notification_preferences, last_login, last_active_at, deleted_at, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'customer@procolis.test', '+221770000101', 'Customer Test', '$2a$12$hpqvx5ye/wEF4Q1dn7Y9lO0N87dP3C3Nfjqvfpf0G3y3UigFtX/66', '$2a$12$BZsr0dSClMOWaID4VuIkCOaWhM0xbKzAU4.X8t9f95e/r4zCjVDQ.', 'client', 'active', NULL, 'Plateau', 'Dakar', 'Dakar', NULL, NULL, NULL, 0.00, 0, 0, 0, true, true, false, true, NULL, '2026-08-04 17:20:30.258+00', '2026-08-04 17:20:30.258+00', NULL, '2026-08-02 21:35:27.637+00', '2026-08-04 17:20:30.261+00');


--
-- PostgreSQL database dump complete
--

\unrestrict hPQWxF7QuWb5W3eJlYkxhQZrXFAli9X9dP40NP0wxjptThvRi8tGniuRh88RU24

