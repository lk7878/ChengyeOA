/** Loads the direct-launch module resolver into this Node process. */
import {register} from 'node:module'
register(new URL('./direct-resolve-hook.mjs', import.meta.url), {parentURL: import.meta.url, data: {anchor: process.env.OA_DIRECT_MODULES}})
