import { servePreview } from '../application/files/preview';
import { Controller } from 'egg';
import { StorageManagement } from '../application/collaboration/storage-management';
import { PersonalFileTransfer } from '../application/collaboration/personal-file-transfer';
import { createReadStream } from 'node:fs';
export default class PersonalFileController extends Controller {
  private svc(){return new PersonalFileTransfer(this.ctx.prisma,this.ctx.state.authorization);}
  private respond(data:unknown){this.ctx.body={code:200,data};}
  async index(){this.respond(await this.svc().list(this.ctx.query));}
  async remove(){this.respond(await this.svc().remove(this.ctx.request.body));}
  async trash(){this.respond(await this.svc().trash());}
  async restore(){this.respond(await this.svc().restore(this.ctx.params.id,this.ctx.request.body));}
  async purgeMany(){this.respond(await this.svc().purgeMany(this.ctx.request.body));}
  async purge(){this.respond(await this.svc().purge(this.ctx.params.id,this.ctx.request.body));}
  async create(){this.respond(await this.svc().create(this.ctx.request.body));}
  async replace(){this.respond(await this.svc().replace(this.ctx.params.id,this.ctx.request.body));}
  async download(){this.respond(await this.svc().download(this.ctx.params.id));}
  async archive(){
    const cancellation=new AbortController();
    const cancel=()=>cancellation.abort();
    this.ctx.res.once('close',cancel);
    try{
      const zip=await this.svc().folderArchive(this.ctx.params.id,cancellation.signal);
      if(cancellation.signal.aborted){await zip.cleanup();return;}
      const stream=createReadStream(zip.path);
      const cleanup=()=>{stream.destroy();void zip.cleanup().catch(error=>this.ctx.logger.error(error));};
      stream.once('close',cleanup);
      this.ctx.res.once('close',cleanup);
      this.ctx.set('Cache-Control','private, no-store');
      this.ctx.type='application/zip';
      this.ctx.attachment(zip.name);
      this.ctx.body=stream;
    }finally{this.ctx.res.removeListener('close',cancel);}
  }
  async access(){this.respond(await this.svc().accessSettings(this.ctx.params.id));}
  async share(){this.respond(await this.svc().share(this.ctx.params.id,this.ctx.request.body));}
  async revokeShare(){this.respond(await this.svc().revokeShare(this.ctx.params.id,this.ctx.request.body));}
  async rename(){this.respond(await this.svc().rename(this.ctx.params.id,this.ctx.request.body));}
  async begin(){this.respond(await this.svc().begin(this.ctx.request.body));}
  async uploadStatus(){this.respond(await this.svc().uploadStatus(this.ctx.params.id));}
  async chunk(){const stream=await this.ctx.getFileStream();try{this.respond(await this.svc().chunk(this.ctx.params.id,Number(this.ctx.query.offset),stream));}finally{stream.resume();}}
  async complete(){this.respond(await this.svc().complete(this.ctx.params.id));}
  async versions(){this.respond(await this.svc().versions(this.ctx.params.id));}
  async content() { await this.sendContent(false); }
  private async sendContent(global: boolean) {
    const row = await this.svc().content(this.ctx.params.id, Number(this.ctx.params.version), global);
    if (this.ctx.query.preview === '1') return servePreview(this.ctx, row.name, row.path);
    this.ctx.set('Cache-Control', 'private, no-store');
    this.ctx.attachment(row.name);
    this.ctx.body = createReadStream(row.path);
  }
  async publication(){this.respond(await this.svc().publication(this.ctx.params.id,this.ctx.query.version?Number(this.ctx.query.version):undefined));}
  async grantPublication(){this.respond(await this.svc().grantPublication(this.ctx.params.id,this.ctx.request.body));}
  async storage(){this.ctx.set('Cache-Control','private, no-store');this.respond(await new StorageManagement(this.ctx.prisma,this.ctx.state.authorization).report(this.ctx.query));}
  async allFiles(){this.respond(await this.svc().allFiles());}
  async globalContent() { await this.sendContent(true); }
  async people(){this.respond(await this.svc().people(String(this.ctx.query.keyword??'')));}
}
