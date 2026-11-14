import init from './sqlite/index.mjs';
let sqlite,pool,db;
self.onmessage=async({data})=>{try{
  sqlite??=await init();pool??=await sqlite.installOpfsSAHPoolVfs({name:'chengye-spec-probe',directory:'/chengye-spec-probe',initialCapacity:6});db??=new pool.OpfsSAHPoolDb('/probe.db');
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS evidence USING fts5(text); CREATE TABLE IF NOT EXISTS raw_source(id INTEGER PRIMARY KEY, bytes BLOB)');
  if(data.write){db.exec({sql:'INSERT INTO evidence(text) VALUES (?);',bind:['Chengye evidence local persistence']});db.exec({sql:'INSERT OR REPLACE INTO raw_source VALUES (1,?)',bind:[new Uint8Array([0,1,2,255])]});}
  const result={sqliteVersion:sqlite.version.libVersion,fts5:db.selectValue("SELECT COUNT(*) FROM evidence WHERE evidence MATCH 'persistence'"),rawBytes:Array.from(db.selectValue('SELECT bytes FROM raw_source WHERE id=1')||[]),crossOriginIsolated:self.crossOriginIsolated};
  db.close();db=undefined;pool.pauseVfs();self.postMessage({ok:true,result});
}catch(error){self.postMessage({ok:false,error:error.message});}};
