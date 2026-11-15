import test from 'node:test'
import assert from 'node:assert/strict'
import {isPublicAddress,publicDestination} from '../src/public-network.js'
test('task network rejects host, private, metadata and reserved addresses',async()=>{
 for(const address of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isPublicAddress(address),false,address)
 assert.equal(isPublicAddress('1.1.1.1'),true)
 for(const target of ['127.0.0.1:443','localhost:443','example.com:22','user@example.com:443','example.com:443/','[::1]:443'])await assert.rejects(publicDestination(target))
})
