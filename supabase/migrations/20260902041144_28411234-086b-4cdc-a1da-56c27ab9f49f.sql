REVOKE ALL PRIVILEGES ON TABLE public.launch_schedule_communications FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.launch_schedule_communications FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.launch_schedule_communications FROM authenticated;
GRANT SELECT ON TABLE public.launch_schedule_communications TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.launch_schedule_communications TO service_role;