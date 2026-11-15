import dns from 'node:dns/promises'
import net from 'node:net'

// Only globally routable IPv4 is accepted. Resolve once, then connect to that
// exact address so DNS rebinding cannot turn a public hostname into a LAN hop.
export function isPublicAddress(address) {
 if(net.isIP(address)!==4)return false
 const [a,b,c]=address.split('.').map(Number)
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)
}
export async function publicDestination(authority) {
 if(typeof authority!=='string'||!/^([a-z0-9.-]+):443$/i.test(authority))throw Error('仅允许公共 HTTPS 站点')
 const host=authority.slice(0,-4)
 const results=await dns.lookup(host,{family:4,all:true})
 if(!results.length||results.some(r=>!isPublicAddress(r.address)))throw Error('禁止访问宿主机或内网地址')
 return results[0].address
}
export function installPublicTunnel(server,validate) {
 const sockets=new Set()
 server.on('connect',async(req,client,head)=>{
  let remote
  const cleanup=()=>{client.destroy();remote?.destroy();sockets.delete(client);if(remote)sockets.delete(remote)}
  sockets.add(client);client.on('error',cleanup);client.on('close',cleanup)
  try{
   await validate();const address=await publicDestination(req.url)
   if(client.destroyed)return
   remote=net.connect({host:address,port:443});sockets.add(remote)
   remote.setTimeout(120000,cleanup);remote.on('error',cleanup);remote.on('close',cleanup)
   remote.on('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote).pipe(client)})
  }catch{client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')}
 })
 return ()=>{for(const socket of sockets)socket.destroy();sockets.clear()}
}
