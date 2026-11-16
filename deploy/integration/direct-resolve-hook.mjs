/** Resolves packages whose bundle links point at sandbox paths that do not exist on the host. */
import {pathToFileURL} from 'node:url'
let anchor
export function initialize(data){anchor=data?.anchor}
export async function resolve(specifier, context, nextResolve){
 try{return await nextResolve(specifier, context)}catch(error){
  if(!anchor||error.code!=='ERR_MODULE_NOT_FOUND'||specifier.startsWith('.')||specifier.startsWith('/')||specifier.includes(':'))throw error
  return nextResolve(specifier, {...context, parentURL: pathToFileURL(anchor).href})
 }
}
