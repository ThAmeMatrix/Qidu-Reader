import {createHash} from 'node:crypto';
export function bencode(value){
  if(Buffer.isBuffer(value))return Buffer.concat([Buffer.from(value.length+':'),value]);
  if(typeof value==='string')return bencode(Buffer.from(value));
  if(typeof value==='number')return Buffer.from('i'+value+'e');
  if(Array.isArray(value))return Buffer.concat([Buffer.from('l'),...value.map(bencode),Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'),...Object.keys(value).sort().flatMap(key=>[bencode(key),bencode(value[key])]),Buffer.from('e')]);
}
export function torrentFixture(base,files,options={}){
  const entries=Object.entries(files),data=Buffer.concat(entries.map(([,bytes])=>bytes)),pieceLength=16384,pieces=[];
  for(let i=0;i<data.length;i+=pieceLength)pieces.push(createHash('sha1').update(data.subarray(i,i+pieceLength)).digest());
  const info={name:options.name||'Qidu books','piece length':pieceLength,pieces:Buffer.concat(pieces),files:entries.map(([name,bytes])=>({length:bytes.length,path:name.split('/')}))};
  const hash=createHash('sha1').update(bencode(info)).digest('hex'),bytes=bencode({info,'url-list':[base+'/seed/'],encoding:'UTF-8'});
  return {bytes,hash,magnet:`magnet:?xt=urn:btih:${hash}&dn=Qidu%20books&xs=${encodeURIComponent(base+'/book.torrent')}`,info};
}
export function serveSeed(req,res,files,name='Qidu books'){
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=pathname.replace('/seed/'+name+'/',''),bytes=files[file];
  if(!bytes){res.writeHead(404);res.end();return;}
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
  res.writeHead(range?206:200,{'Content-Type':'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));
}
