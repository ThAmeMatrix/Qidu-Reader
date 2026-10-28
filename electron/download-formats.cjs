const formats=['EPUB','PDF','TXT','ZIP','RAR','7Z'];
function formatFromName(value){return String(value||'').match(/\.(epub|pdf|txt|zip|rar|7z)$/i)?.[1].toUpperCase();}
function formatFromMime(value){
  const type=String(value||'').split(';')[0].trim().toLowerCase();
  if(type==='application/epub+zip')return 'EPUB';
  if(type==='application/pdf')return 'PDF';
  if(type==='text/plain')return 'TXT';
  if(['application/zip','application/x-zip-compressed'].includes(type))return 'ZIP';
  if(['application/vnd.rar','application/x-rar','application/x-rar-compressed'].includes(type))return 'RAR';
  if(type==='application/x-7z-compressed')return '7Z';
}
module.exports={formats,formatFromName,formatFromMime};
