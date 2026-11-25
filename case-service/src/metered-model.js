import {completion} from './model-connections.js'
// Never store prompts, response text or credentials. Only supplier usage counters are retained.
export async function meteredCompletion({billing,context,route,body,signal}){
 const ref=billing?.start(context)
 let response
 try{response=await completion(route,{...body,...(body.stream?{stream_options:{...body.stream_options,include_usage:true}}:{})},signal)}
 catch(error){if(ref)billing.finish(ref,{status:signal.aborted?'INTERRUPTED':'FAILED'});throw error}
 if(!ref)return response
 let usage,model,responseId,done=false,buffer='',invalid=false,sawDone=false
 const decoder=new TextDecoder(),sse=(response.headers.get('content-type')||'').includes('text/event-stream')
 const capture=data=>{if(data?.usage)usage=data.usage;if(typeof data?.model==='string')model=data.model;if(typeof data?.id==='string')responseId=data.id}
 const parse=line=>{if(!line.startsWith('data:'))return;const value=line.slice(5).trim();if(value==='[DONE]'){sawDone=true;return}if(!value)return;try{capture(JSON.parse(value))}catch{invalid=true}}
 const consume=(chunk,final=false)=>{
  buffer+=decoder.decode(chunk||new Uint8Array(),{stream:!final})
  if(sse){let at;while((at=buffer.indexOf('\n'))>=0){parse(buffer.slice(0,at).replace(/\r$/,''));buffer=buffer.slice(at+1)}if(final&&buffer)parse(buffer)}
  else if(final){try{capture(JSON.parse(buffer))}catch{invalid=true}}
  if(buffer.length>16*1024*1024){invalid=true;buffer=''}
 }
 const finish=status=>{if(done)return;done=true;billing.finish(ref,{usage:invalid?undefined:usage,model,responseId,status,httpStatus:response.status})}
 if(!response.body){finish('FAILED');return response}
 const reader=response.body.getReader()
 const observed=new ReadableStream({
  async pull(controller){try{const part=await reader.read();if(part.done){consume(undefined,true);finish(response.ok?'COMPLETED':'FAILED');controller.close()}else{consume(part.value);controller.enqueue(part.value)}}catch(e){finish('INTERRUPTED');controller.error(e)}},
  async cancel(reason){try{await reader.cancel(reason)}finally{finish(response.ok?(sawDone?'COMPLETED':'INTERRUPTED'):'FAILED')}}
 })
 return new Response(observed,{status:response.status,statusText:response.statusText,headers:response.headers})
}
