-- Minimal isolated test dependencies, never applied to the hosted app.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid UNIQUE NOT NULL,credits_balance integer DEFAULT 20);
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid,_role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE TABLE public.documents(id uuid PRIMARY KEY);
CREATE TABLE public.credit_purchases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,reference text UNIQUE,kind text,status text,credited boolean DEFAULT false);
CREATE TABLE public.credit_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,amount integer,source text);
CREATE TABLE public.user_usage(action_type text,credits_used integer,created_at timestamptz DEFAULT now());
INSERT INTO auth.users(id) VALUES('11111111-1111-4111-8111-111111111111');
INSERT INTO public.profiles(user_id) VALUES('11111111-1111-4111-8111-111111111111');
INSERT INTO public.user_roles VALUES('11111111-1111-4111-8111-111111111111','admin');