-- Fix : supabase_auth_admin a besoin de droits complets sur
-- le schema public pour fonctionner avec les FK vers auth.users
-- Résultat sans ces grants : 500 "Database error querying schema"
-- sur /token et /recover

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO supabase_auth_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO supabase_auth_admin;
