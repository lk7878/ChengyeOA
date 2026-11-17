import {describe,it,expect,vi} from 'vitest';
import {connectSmartCase, type EntryConfig} from './connect';
const origin='http://oa.example',challenge='a'.repeat(64);
const settings:EntryConfig={url:origin+'/api/auth/start',homeUrl:origin+'/wb/',userId:'current-user'};
function setup(responses:Response[],search=''){
  const config=vi.fn(async()=>settings),launch=vi.fn(async()=>({url:origin+'/api/auth/oa/callback?code=one-time'}));
  const request=vi.fn<typeof fetch>(async()=>{const next=responses.shift();if(!next)throw Error('Unexpected request');return next;});
  const replace=vi.fn();
  return {connection:{origin,search,config,launch,fetch:request,replace},config,launch,request,replace};
}
describe('智慧办案入口',()=>{
  it('checks current OA identity and reuses only a matching valid session, preserving caseId',async()=>{
    const s=setup([Response.json({user:{oaUserId:'current-user'}})],'?caseId=case-1');
    await connectSmartCase(s.connection);
    expect(s.config).toHaveBeenCalledWith('/smart-case/config?caseId=case-1');
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.launch).not.toHaveBeenCalled();
    expect(s.replace).toHaveBeenCalledWith(origin+'/wb/?caseId=case-1');
  });
  it.each([Response.json({user:{oaUserId:'previous-user'}}),new Response(null,{status:401}),new Response(null,{status:403})])('does not enter an old or invalid identity; uses PKCE',async response=>{
    const s=setup([response,Response.json({challenge})],'?caseId=case-1');
    await connectSmartCase(s.connection);
    const url=new URL(String(s.request.mock.calls[1][0]));
    expect(url.searchParams.get('caseId')).toBe('case-1');expect(url.searchParams.get('return')).toBe(origin);
    expect(s.request.mock.calls[1][1]).toMatchObject({credentials:'include',cache:'no-store'});
    expect(s.launch).toHaveBeenCalledExactlyOnceWith(challenge);
    expect(s.replace).toHaveBeenCalledExactlyOnceWith(origin+'/api/auth/oa/callback?code=one-time');
  });
  it('supports a running older service without navigating through a second OA page',async()=>{
    const returned=new Response('OA HTML must never execute');
    Object.defineProperties(returned,{redirected:{value:true},url:{value:origin+'/smart-case?challenge='+challenge}});
    const s=setup([new Response(null,{status:401}),returned]);await connectSmartCase(s.connection);
    expect(s.launch).toHaveBeenCalledWith(challenge);expect(s.replace).toHaveBeenCalledTimes(1);
    expect(s.replace.mock.calls[0][0]).toContain('/api/auth/oa/callback');
  });
  it('rejects OA authentication or permission failures before using a smart session',async()=>{
    const s=setup([]);s.config.mockRejectedValue(Error('FORBIDDEN'));
    await expect(connectSmartCase(s.connection)).rejects.toThrow('FORBIDDEN');
    expect(s.request).not.toHaveBeenCalled();expect(s.replace).not.toHaveBeenCalled();
  });
  it('does not turn a service outage into a login loop',async()=>{
    const s=setup([new Response(null,{status:503})]);await expect(connectSmartCase(s.connection)).rejects.toThrow('暂不可用');
    expect(s.launch).not.toHaveBeenCalled();expect(s.replace).not.toHaveBeenCalled();
  });
  it.each(['https://untrusted.example/smart-case?challenge='+challenge,origin+'/login'])('rejects an unexpected handoff redirect %s',async url=>{
    const returned=new Response('');Object.defineProperties(returned,{redirected:{value:true},url:{value:url}});
    const s=setup([new Response(null,{status:401}),returned]);
    await expect(connectSmartCase(s.connection)).rejects.toThrow('返回地址无效');expect(s.launch).not.toHaveBeenCalled();
  });
  it('retains cross-origin top-level login and the case parameter without weakening cookies',async()=>{
    const s=setup([],'?caseId=case-1');s.config.mockResolvedValue({...settings,url:'https://smart.example/api/auth/start'});
    await connectSmartCase(s.connection);expect(s.request).not.toHaveBeenCalled();
    const url=new URL(s.replace.mock.calls[0][0]);expect(url.origin).toBe('https://smart.example');expect(url.searchParams.get('caseId')).toBe('case-1');
  });
  it('accepts existing challenge links only after current OA validation, and rejects invalid challenges',async()=>{
    const s=setup([],'?challenge='+challenge);await connectSmartCase(s.connection);
    expect(s.config).toHaveBeenCalledTimes(1);expect(s.launch).toHaveBeenCalledWith(challenge);expect(s.request).not.toHaveBeenCalled();
    const invalid=setup([],'?challenge=bad');await expect(connectSmartCase(invalid.connection)).rejects.toThrow('登录校验无效');expect(invalid.launch).not.toHaveBeenCalled();
  });
});
