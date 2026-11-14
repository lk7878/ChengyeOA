import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { connectHarness } from './harness';
import request from './request';
vi.mock('./request',()=>({default:{post:vi.fn()}}));
const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();vi.mocked(request.post).mockReset();});
afterEach(()=>vi.unstubAllGlobals());
const response=(data:unknown,ok=true)=>({ok,json:async()=>data});
const connection={protocol:1,feature:'knowledge',url:'http://localhost:45678/?token=local-launch#oa-view=knowledge',version:'test',dataDirectory:'personal'};
function setup(){fetchMock.mockResolvedValueOnce(response({protocol:1,challenge:'a'.repeat(64)}));vi.mocked(request.post).mockResolvedValue({code:200,data:{ticket:'short-lived-ticket'}});}

test('exchanges only a scoped ticket with the local connector and keeps credentials out of storage',async()=>{
  setup();fetchMock.mockResolvedValueOnce(response(connection));
  expect(await connectHarness('knowledge',43123)).toEqual(connection);
  expect(request.post).toHaveBeenCalledWith('/v1/harness/ticket',{feature:'knowledge',challenge:'a'.repeat(64)});
  const options=fetchMock.mock.calls[1][1];expect(options.credentials).toBe('omit');expect(options.headers).toEqual({'Content-Type':'application/json'});expect(JSON.parse(options.body)).toEqual({feature:'knowledge',challenge:'a'.repeat(64),ticket:'short-lived-ticket'});
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});
test('rejects remote launch addresses and mismatched purposes',async()=>{
  setup();fetchMock.mockResolvedValueOnce(response({...connection,url:'https://remote.example/'}));await expect(connectHarness('knowledge',43123)).rejects.toThrow('无效地址');
  setup();fetchMock.mockResolvedValueOnce(response({...connection,feature:'smart-case'}));await expect(connectHarness('knowledge',43123)).rejects.toThrow('无效地址');
});
test('reports offline and incompatible connectors in Chinese without requesting an OA ticket',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('offline'));await expect(connectHarness('knowledge',43123)).rejects.toThrow('无法连接本机助手');
  fetchMock.mockResolvedValueOnce(response({protocol:0,challenge:'bad'}));await expect(connectHarness('knowledge',43123)).rejects.toThrow('版本不兼容');expect(request.post).not.toHaveBeenCalled();
});
