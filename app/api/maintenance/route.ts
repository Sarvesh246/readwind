import {safeRoute,HttpError} from '@/lib/readwind/security';
import {pruneEphemeral} from '@/lib/readwind/supabase-storage';
export const GET=safeRoute(async(request:Request)=>{
 const secret=process.env.CRON_SECRET;
 if(!secret || request.headers.get('authorization')!==`Bearer ${secret}`)throw new HttpError(401,'Unauthorized.');
 return Response.json(await pruneEphemeral(),{headers:{'Cache-Control':'no-store'}});
});
