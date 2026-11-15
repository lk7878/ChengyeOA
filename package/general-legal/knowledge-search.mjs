import {defineTool} from '@deepseek-ai/dsh-tools'
export const name='oa-knowledge-search'
export const inject=['tools']
export function apply(ctx){ctx.tools.register(defineTool({
 name:'weknora_search',description:'检索本任务选择且当前用户有权访问的已发布知识。返回可定位的知识标题、原文片段与ID；无命中不代表不存在相关法律。',
 parameters:{query:{type:'string',required:true,description:'中文法律问题或精确法规、条款名称'}},
 output:{schema:{type:'object',additionalProperties:false,properties:{data:{type:'array',items:{type:'object',additionalProperties:true}}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
 async execute(args){const response=await fetch('http://127.0.0.1:8090/oa/knowledge/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:args.query})});if(!response.ok)throw Error('授权知识检索失败，请检查目标库和服务状态');return response.json()}
}))}
