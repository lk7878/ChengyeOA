import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {fail} from './admin-config.js'
const kinds={consultation:['disability','injury'],injury_review:['disability','injury'],period:['disability','injury'],medical:['malpractice']}
const skills={consultation:'injury-disability-report-writing',injury_review:'injury-disability-report-review',period:'injury-disability-period-writing',medical:'medical-review-medical-report-writing'}
export async function specialistReport(task,context,args,directory){
 if(!kinds[args.type]?.includes(task.kind)||!context.skills.some(s=>s.id===skills[args.type]))fail('此报告模板或业务规则未获授权',403)
 if(!args.fields||typeof args.fields!=='object'||Object.values(args.fields).some(v=>typeof v!=='string'||v.length>30000))fail('报告字段无效')
 const temp=await mkdtemp(path.join(directory,'report-build-'));try{
  if(args.type==='consultation'){const {writeReportPair}=await import('../../package/injury/fill-docx.mjs');await writeReportPair(args.fields,temp)}
  if(args.type==='injury_review'){const {writeReviewPair}=await import('../../package/injury/review-docx.mjs');await writeReviewPair(args.fields,temp)}
  if(args.type==='period'){const {writePeriodPair}=await import('../../package/injury/period-docx.mjs');await writePeriodPair(args.fields,temp)}
  if(args.type==='medical'){const {writeReportPair,missingChapters,collectSubheadGaps}=await import('../../package/medical-review/fill-docx.mjs');if(missingChapters(args.fields).length||Object.keys(collectSubheadGaps(args.fields)).length)fail('病历报告章节或规定小节不完整，请加载报告写作规则并补齐');await writeReportPair(args.fields,temp)}
  const names=[];for(const file of await readdir(temp)){if(!/\.(md|docx)$/i.test(file)||file.startsWith('.'))continue;const extension=path.extname(file),name=file.slice(0,-extension.length)+'-'+randomUUID().slice(0,8)+extension;await copyFile(path.join(temp,file),path.join(directory,'workspace/reports',name),constants.COPYFILE_EXCL);names.push(name)}return {files:names,status:'待律师复核；保存到我的文件，不正式归档'}
 }finally{await rm(temp,{recursive:true,force:true})}
}
