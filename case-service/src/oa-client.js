export const oaBase=()=>String(process.env.OA_API_BASE||'http://127.0.0.1:7001').replace(/\/$/,'')
export async function oa(token,route,{method='GET',body,headers={},raw=false}={}) {
  const response=await fetch(oaBase()+'/api/v1'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:route.endsWith('/complete')||route==='/smart-case/archive'?undefined:AbortSignal.timeout(120000)})
  if(!response.ok){const error=new Error('OA '+response.status);error.statusCode=response.status;try{const data=await response.json();error.message=data.message||data.code||error.message}catch{}throw error}
  if(raw)return response
  const data=await response.json();if(data.code!==200)throw new Error(data.message||'OA 操作失败');return data.data
}
