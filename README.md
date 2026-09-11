# FREE FIRE ANALYST — upgraded build

This build fixes the analyser layout and adds:
- Supabase email/password authentication
- Private per-user video storage
- Persistent video history
- Video playback
- Circle, arrow, draw and note tools
- Timestamped saved evidence with stored geometry
- Overlay rendering near the saved timestamp
- Video zoom
- AI analysis using sampled screenshots + saved evidence
- Evidence-first AI prompting with confidence and limitations
- Configurable map viewer with zoom

## Important
The app is not fully live until you configure Supabase:
1. Create a Supabase project.
2. Run `supabase/schema.sql` in SQL Editor.
3. Put the Project URL and anon key into `app.js`.
4. Deploy `supabase/functions/analyze-video`.
5. Add `GEMINI_API_KEY` as a Supabase Edge Function secret.
6. Serve the app from a web host (for example GitHub Pages/Netlify/Vercel).

The AI reviews sampled frames, not every frame of a long video. Therefore it must not be treated as a perfect automatic referee. The prompt is deliberately evidence-first to reduce invented conclusions.

Do not put your Gemini private key in `app.js`.
