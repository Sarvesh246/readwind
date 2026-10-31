import type {Settings} from './types';
type SqlTag = (strings:TemplateStringsArray,...values:unknown[])=>Promise<unknown>;
/** Merge each device's latest pace counters atomically, including stale/offline saves. */
export async function persistSettings(db:SqlTag, owner:string, value:Settings) {
  return db`INSERT INTO folio_settings(owner_id,data) VALUES(${owner},${JSON.stringify(value)}::jsonb)
    ON CONFLICT(owner_id) DO UPDATE SET data=EXCLUDED.data || jsonb_build_object('_bookDeletions',COALESCE(folio_settings.data->'_bookDeletions','{}'::jsonb)) || jsonb_build_object('readingPace',
      COALESCE((SELECT jsonb_object_agg(key,value) FROM (
        SELECT DISTINCT ON (key) key,value FROM (
          SELECT * FROM jsonb_each(COALESCE(folio_settings.data->'readingPace','{}'::jsonb))
          UNION ALL
          SELECT * FROM jsonb_each(COALESCE(EXCLUDED.data->'readingPace','{}'::jsonb))
        ) entries ORDER BY key,(value->>'samples')::bigint DESC
      ) latest),'{}'::jsonb)) || jsonb_build_object('readingLog',
      COALESCE((SELECT jsonb_object_agg(key,value) FROM (
        SELECT DISTINCT ON (key) key,value FROM (
          SELECT * FROM jsonb_each(COALESCE(folio_settings.data->'readingLog','{}'::jsonb))
          UNION ALL
          SELECT * FROM jsonb_each(COALESCE(EXCLUDED.data->'readingLog','{}'::jsonb))
        ) entries WHERE key >= to_char(now() - interval '730 days','YYYY-MM-DD')
        ORDER BY key,(value->>'pages')::bigint DESC,(value->>'seconds')::numeric DESC
      ) latest),'{}'::jsonb)),updated_at=now()`;
}
