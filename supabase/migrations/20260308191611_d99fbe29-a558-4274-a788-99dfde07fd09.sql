CREATE TABLE public.intel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL DEFAULT 'incident',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  location_name TEXT,
  country TEXT,
  source_url TEXT,
  source_name TEXT,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity TEXT DEFAULT 'medium',
  tags TEXT[] DEFAULT '{}'
);

ALTER TABLE public.intel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read intel events" ON public.intel_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role can insert intel events" ON public.intel_events FOR INSERT TO anon WITH CHECK (true);

CREATE INDEX idx_intel_events_time ON public.intel_events (event_time DESC);