import { z } from 'zod'
import { accountDb } from '@/lib/server/auth'
import { accountUser, noStore } from '@/lib/server/boards'

/** The foreign key moves the space's boards to Unsorted; their contents are preserved. */
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}) {
 const user=await accountUser(req,{mutating:true});if(user instanceof Response)return user
 const parsed=z.string().uuid().safeParse((await params).id)
 if(!parsed.success)return Response.json({error:'Space not found.'},{status:404})
 try {
  const {data,error}=await accountDb().from('loci_spaces').delete().eq('id',parsed.data).eq('user_id',user.id).select('id').maybeSingle()
  if(error)throw error
  return data ? Response.json({deleted:true},{headers:noStore}) : Response.json({error:'Space not found.'},{status:404})
 } catch {return Response.json({error:'Could not delete the space.'},{status:503})}
}
