import {readDownloadPage,type DownloadFiles} from './downloads';
export async function followDownloadPages(initial:DownloadFiles,signal?:AbortSignal,onProgress?:(url:string)=>void):Promise<DownloadFiles>{
 if(signal?.aborted)throw new DOMException('已取消','AbortError');
 if(!initial.pages?.length)return initial;
 const result:DownloadFiles={...initial,files:[...initial.files],resources:[...(initial.resources||[])],pages:[]};
 const seen=new Set<string>(initial.pageUrl?[initial.pageUrl]:[]),fileUrls=new Set(result.files.map(f=>f.url)),resources=new Set(result.resources?.map(r=>r.url));
 const pending=(initial.pages||[]).map(page=>({...page,depth:1}));let visited=0;const failures:string[]=[];
 while(pending.length&&visited<12){
  if(signal?.aborted)throw new DOMException('已取消','AbortError');
  const link=pending.shift()!;if(seen.has(link.url))continue;seen.add(link.url);visited++;onProgress?.(link.url);
  try{
   const next=await readDownloadPage(link.url,signal);if(signal?.aborted)throw new DOMException('已取消','AbortError');
   for(const file of next.files)if(!fileUrls.has(file.url)){fileUrls.add(file.url);result.files.push(file);}
   for(const resource of next.resources||[])if(!resources.has(resource.url)){resources.add(resource.url);result.resources!.push(resource);}
   if(link.depth<5)pending.push(...(next.pages||[]).map(page=>({...page,depth:link.depth+1})));else result.pages!.push(...(next.pages||[]));
   if(!next.files.length&&!next.resources?.length&&!next.pages?.length){result.pages!.push(link);if(next.message)failures.push(next.message);}
  }catch(e){if(signal?.aborted)throw e;result.pages!.push(link);failures.push((e as Error).message);}
 }
 result.pages!.push(...pending.filter(page=>!seen.has(page.url)));
 result.message=result.files.length?`已找到 ${result.files.length} 个文件，选择「加载到本地」后下载。`:result.resources!.length?'已找到分享资源，正在继续解析文件。':failures[0]||'暂未找到文件，可检查剩余入口或重试。';
 return result;
}
