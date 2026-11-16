// Tests always use system samples; provider errors never expose credentials or raw responses.
export async function callModel(connection,key,model,body,{fetcher=fetch,signal,endpoint='chat/completions'}={}){
 const response=await fetcher(connection.baseUrl.replace(/\/+$/,'')+'/'+endpoint,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({...body,model:model.modelId}),signal:signal||AbortSignal.timeout(60000),redirect:'error'})
 if(!response.ok){await response.body?.cancel();throw Error('模型服务返回 HTTP '+response.status)}
 return response
}
export async function probeModel(connection,key,model,check,fetcher=fetch){
 const call=(body,endpoint)=>callModel(connection,key,model,body,{fetcher,endpoint})
 if(check==='embedding'){
  const data=await(await call({input:['系统连通性样例：材料目录。']},'embeddings')).json(),v=data.data?.[0]?.embedding
  if(!Array.isArray(v)||v.length<2||!v.every(Number.isFinite))throw Error('未返回有效向量')
  return {dimensions:v.length}
 }
 if(check==='rerank'){
  const data=await(await call({query:'合同',documents:['合同履行争议','天气晴朗'],top_n:2},'rerank')).json()
  if(!Array.isArray(data.results)||!data.results.some(v=>Number.isFinite(v.relevance_score)))throw Error('未返回有效重排序结果')
  return {}
 }
 let body={messages:[{role:'user',content:'这是系统连通性测试，请仅回复 OK。'}],max_tokens:512}
 if(check==='vision')body.messages=[{role:'user',content:[{type:'text',text:'简要描述这张系统测试图片的颜色。'},{type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII='}}]}]
 if(check==='tools')body={...body,messages:[{role:'user',content:'请调用 system_probe 工具，参数 value 为 ok。'}],tools:[{type:'function',function:{name:'system_probe',description:'系统测试，无副作用',parameters:{type:'object',properties:{value:{type:'string'}},required:['value']}}}],tool_choice:{type:'function',function:{name:'system_probe'}}}
 if(check==='stream'){
  const response=await call({...body,stream:true});let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString();if(text.length>100000)throw Error('流式测试响应过长')}
  if(!text.split('\n').some(line=>{if(!line.startsWith('data:'))return false;try{return !!JSON.parse(line.slice(5)).choices?.some(c=>c.delta?.content)}catch{return false}}))throw Error('未返回有效流式文本')
  return {}
 }
 const data=await(await call(body)).json(),message=data.choices?.[0]?.message
 if(check==='tools'){if(!message?.tool_calls?.some(t=>{if(t.function?.name!=='system_probe')return false;try{return JSON.parse(t.function.arguments).value==='ok'}catch{return false}}))throw Error('模型未按要求调用工具')}
 else if(typeof message?.content!=='string'||!message.content.trim())throw Error('未返回有效模型文本')
 return {}
}
