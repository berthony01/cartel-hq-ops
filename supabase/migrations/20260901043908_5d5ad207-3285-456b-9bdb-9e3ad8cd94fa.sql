CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_active_sticker_motion_telegram_prepare_uniq
  ON public.ai_jobs (sticker_id)
  WHERE job_type = 'sticker_motion_telegram_prepare'
    AND status IN ('queued', 'running')
    AND sticker_id IS NOT NULL;