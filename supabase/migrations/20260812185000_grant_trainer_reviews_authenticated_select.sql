-- Trainer Profiles reads trainer_reviews from the browser with an authenticated
-- user JWT. RLS policy permits authenticated reads, but the role also needs
-- table privileges.

grant select on public.trainer_reviews to authenticated;

notify pgrst, 'reload schema';
