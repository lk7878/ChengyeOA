import request from './request';
import type { ApiResponse } from '@/types';
export type HarnessFeature = 'knowledge' | 'smart-case';
export interface HarnessConnection { protocol: 1; url: string; version: string; dataDirectory: string; feature: HarnessFeature }
const errors: Record<string,string> = {
  HARNESS_NOT_BUILT: '未找到可用的 Harness 构建，请检查本机连接器配置中的安装路径。',
  CHALLENGE_INVALID: '连接验证已过期，请重新连接。', OA_AUTH_REJECTED: '登录或模块权限已失效，请重新登录后连接。',
  HARNESS_SETUP_FAILED: '个人助手配置初始化失败，请查看本机数据目录中的 setup-diagnostic.log。',
  HARNESS_START_FAILED: '助手启动失败，请查看本机数据目录中的 runtime-diagnostic.log。',
  HARNESS_SETUP_TIMEOUT: '首次初始化超时，请检查本机 pnpm 是否可用后重试。',
  HARNESS_START_TIMEOUT: '助手启动超时，请检查本机运行环境后重试。',
  HARNESS_ALREADY_RUNNING: '该个人助手已在另一个连接器中运行，请先停止旧连接器。',
  HARNESS_INSTANCE_LIMIT: '本机运行的助手数量已达上限，请先停止不用的实例。',
};
async function local<T>(base: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(body?180000:5000)}); }
  catch { throw new Error('无法连接本机助手。请启动本机连接器，并允许浏览器访问本地网络，然后重试。'); }
  const result=await response.json();if(!response.ok)throw new Error(errors[result.error]||'本机助手连接失败，请检查配置后重试。');return result as T;
}
export async function connectHarness(feature: HarnessFeature, port: number, stop = false): Promise<HarnessConnection | undefined> {
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('请输入有效的连接器端口。');
  const base='http://'+(location.hostname==='localhost'?'localhost':'127.0.0.1')+':'+port;
  const health=await local<{protocol:number;challenge:string}>(base,'/health');
  if(health.protocol!==1||!/^[a-f0-9]{64}$/.test(health.challenge))throw new Error('本机连接器版本不兼容，请升级后重试。');
  const reply=await request.post<ApiResponse<{ticket:string}>>('/v1/harness/ticket',{feature,challenge:health.challenge});
  const result=await local<HarnessConnection>(base,stop?'/stop':'/launch',{feature,challenge:health.challenge,ticket:reply.data.ticket});
  if(stop)return undefined;
  const url=new URL(result.url);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||!url.port||url.username||url.password||result.protocol!==1||result.feature!==feature)throw new Error('本机助手返回了无效地址。');
  return result;
}
