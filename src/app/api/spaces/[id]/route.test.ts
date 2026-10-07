import { beforeEach, expect, it, vi } from 'vitest'
import { DELETE } from './route'
const mocks=vi.hoisted(()=>({user:vi.fn(),db:vi.fn()}))
vi.mock('@/lib/server/auth',()=>({accountDb:mocks.db}))
vi.mock('@/lib/server/boards',()=>({accountUser:mocks.user,noStore:{'Cache-Control':'no-store'}}))
const id='f0949771-3fc7-492c-9893-e8a3cc9b9b02'
beforeEach(()=>vi.resetAllMocks())
it('requires an authenticated mutation before touching storage',async()=>{
 mocks.user.mockResolvedValue(new Response(null,{status:401}))
 expect((await DELETE(new Request('https://loci.test/api/spaces/'+id),{params:Promise.resolve({id})})).status).toBe(401)
 expect(mocks.db).not.toHaveBeenCalled()
})
it('restricts deletion to the current user and reports missing spaces',async()=>{
 mocks.user.mockResolvedValue({id:'owner'})
 const query={delete:vi.fn(),eq:vi.fn(),select:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:null,error:null})}
 query.delete.mockReturnValue(query);query.eq.mockReturnValue(query);query.select.mockReturnValue(query)
 mocks.db.mockReturnValue({from:vi.fn().mockReturnValue(query)})
 const response=await DELETE(new Request('https://loci.test/api/spaces/'+id),{params:Promise.resolve({id})})
 expect(query.eq.mock.calls).toEqual([['id',id],['user_id','owner']]);expect(response.status).toBe(404)
})
