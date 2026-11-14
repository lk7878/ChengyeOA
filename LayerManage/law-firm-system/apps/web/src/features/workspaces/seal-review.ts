export function sealReview(value: unknown): {decision:string;reason:string} {
  try { const v=JSON.parse(String(value)); return {decision:String(v.decision || '待审核'),reason:String(v.reason || '')}; }
  catch { return {decision:'待审核',reason:''}; }
}
