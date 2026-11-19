import {defineTool} from '@deepseek-ai/dsh-tools'
import {readFile,open} from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
export const name='injury-read-material'
export const inject=['tools']
export function apply(ctx){
 ctx.tools.register(defineTool({
  name:'read_task_material',description:'不填文件标识时列出本任务材料；读取指定版本的文本材料时返回有段落编号的正文。',
  parameters:{fileId:{type:'string',description:'任务材料标识'},version:{type:'number'},paragraph:{type:'number',description:'起始段落，默认 1'}},
  output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  async execute({fileId,version,paragraph}){
   const {inputs}=JSON.parse(await readFile('/run/oa-task/materials.json','utf8'))
   if(!fileId)return {materials:inputs.map(({fileId,version,name})=>({fileId,version,name}))}
   const ref=inputs.find(row=>row.fileId===fileId&&row.version===version)
   if(!ref||path.basename(ref.localName)!==ref.localName)throw Error('请选择任务中的文件版本')
   if(!/\.(md|txt|csv)$/i.test(ref.name))throw Error('此问答工具支持文本材料，请使用已核对的文本版本')
   const file=await open(path.join('/workspace/materials',ref.localName),constants.O_RDONLY|constants.O_NOFOLLOW)
   try{
    if((await file.stat()).size>8*1024*1024)throw Error('文本超过读取上限，请分段上传')
    const first=Math.max(1,Math.floor(paragraph)||1)
    const lines=(await file.readFile('utf8')).split(/\r?\n/)
    const paragraphs=lines.slice(first-1,first+38).map((text,index)=>({paragraph:first+index,text:text.slice(0,4000)})).filter(row=>row.text.trim())
    return {source:ref.name,version,paragraphs}
   }finally{await file.close()}
  }
 }))
}
