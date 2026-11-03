import {owner,sql,rateLimit,unauthorized,usesS3Storage,storageFetch} from '@/lib/readwind/server';
import {resolveSession,provider} from '@/lib/readwind/supabase-auth';
import {postgresClient} from '@/lib/readwind/postgres';
import {finishAccountDeletion} from '@/lib/readwind/supabase-storage';
import {safeRoute,readJson,HttpError,sameOrigin} from '@/lib/readwind/security';
export const GET=safeRoute(async(request:Request)=>{
 const session=process.env.READWIND_BACKEND==='supabase'?await resolveSession(request):null;
 const user=session?.user.id || await owner(request);if(!user)return unauthorized();await rateLimit(`account:${user}`,60);
 const files=await sql(user)`SELECT count(*) AS files,COALESCE(sum(bytes),0) AS bytes FROM folio_files WHERE owner_id=${user}`;
 let sessions: {id:string;current:boolean;expiresAt:string;lastUsed:string}[]=[];
 if(process.env.READWIND_BACKEND==='supabase'){
  const session=await resolveSession(request);
  if(session){const db=postgresClient();const rows=await db`SELECT s.token_hash,s.expires_at,s.updated_at FROM folio_sessions s WHERE s.auth_user_id=(SELECT auth_user_id FROM folio_sessions WHERE token_hash=${session.tokenHash}) AND s.expires_at>now() ORDER BY s.updated_at DESC`;
   sessions=rows.map(row=>({id:row.token_hash,current:row.token_hash===session.tokenHash,expiresAt:new Date(row.expires_at).toISOString(),lastUsed:new Date(row.updated_at).toISOString()}));
  }
 }
 const deleting=await sql(user)`SELECT 1 FROM folio_settings WHERE owner_id=${user} AND data ? '_deletingAuthUser'`;
 const capacity=process.env.READWIND_BACKEND==='supabase'?await sql(user)`SELECT used_bytes,limit_bytes FROM folio_storage_capacity WHERE id`:[];
 return Response.json({projectAvailable:capacity.length?Math.max(0,Number(capacity[0].limit_bytes)-Number(capacity[0].used_bytes)):undefined,deletionPending:!!deleting.length,bytes:Number(files[0].bytes),files:Number(files[0].files),limit:524288000,provider:usesS3Storage()?'s3':'supabase',sessions},{headers:{'Cache-Control':'private, no-store'}});
});
export const POST=safeRoute(async(request:Request)=>{
 if(!sameOrigin(request))throw new HttpError(403,'Invalid origin.');
 if(process.env.READWIND_BACKEND!=='supabase')throw new HttpError(400,'Account controls require the configured Supabase backend.');
 const session=await resolveSession(request);if(!session)return unauthorized();
 await rateLimit(`account-control:${session.user.id}`,20);
 const input=await readJson(request,4096) as {action?:string;id?:string;password?:string;confirmation?:string};
 const db=postgresClient();
 const identity=await db`SELECT auth_user_id FROM folio_sessions WHERE token_hash=${session.tokenHash}`;
 const authUser=identity[0]?.auth_user_id;if(!authUser)return unauthorized();
 if(input.action==='revoke'){
  if(input.id && !/^[a-f0-9]{64}$/.test(input.id))throw new HttpError(400,'Invalid session.');
  if(input.id===session.tokenHash)throw new HttpError(400,'Use Sign out for this session.');
  await db`DELETE FROM folio_sessions WHERE auth_user_id=${authUser} AND token_hash<>${session.tokenHash} AND (${!input.id} OR token_hash=${input.id || ''})`;
  return Response.json({ok:true});
 }
 if(input.action!=='delete' || input.confirmation!=='DELETE' || typeof input.password!=='string')throw new HttpError(400,'Confirm account deletion and enter your password.');
 const verified=await provider('/token?grant_type=password',{body:{email:session.user.email,password:input.password}}) as {access_token?:string};
 if(verified.access_token)await provider('/logout?scope=local',{method:'POST',token:verified.access_token});
 const tenant=sql(session.user.id);
 // This durable marker blocks all ordinary account writes and survives retries.
 await tenant`INSERT INTO folio_settings(owner_id,data) VALUES(${session.user.id},jsonb_build_object('_deletingAuthUser',${authUser}::text)) ON CONFLICT(owner_id) DO UPDATE SET data=folio_settings.data || EXCLUDED.data`;
 const files=await tenant`SELECT id FROM folio_files WHERE owner_id=${session.user.id} LIMIT 20`;
 for(const file of files){const response=await storageFetch(`${session.user.id}/${file.id}`,{method:'DELETE'});if(!response.ok && response.status!==404)throw new HttpError(503,'Deletion paused while removing private files. Retry to continue.');await tenant`DELETE FROM folio_files WHERE owner_id=${session.user.id} AND id=${file.id}`;}
 const remaining=await tenant`SELECT count(*) AS count FROM folio_files WHERE owner_id=${session.user.id}`;
 if(Number(remaining[0].count))return Response.json({pending:true,remaining:Number(remaining[0].count)});
 await finishAccountDeletion(authUser);
 return Response.json({ok:true,deleted:true});
});
