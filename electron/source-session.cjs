const { session } = require('electron');
let sourceSession;
const downloadCaptures=new Map();

function getSourceSession() {
  if (!sourceSession) {
    sourceSession = session.fromPartition('persist:qidu-websites');
    // Electron includes the product name in its UA. HTTP headers require Latin-1;
    // use the ASCII product name consistently for both site windows and searches.
    sourceSession.setUserAgent(sourceSession.getUserAgent().replace(/[^\x20-\x7e]+/g, 'QiduReader'));
    sourceSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
    sourceSession.setPermissionCheckHandler(() => false);
    sourceSession.on('will-download', (event,item,web)=>{const capture=downloadCaptures.get(web?.id);if(!capture){event.preventDefault();return;}try{capture(item);}catch{item.cancel();}});
  }
  return sourceSession;
}
function registerDownloadCapture(web,callback){downloadCaptures.set(web.id,callback);return ()=>downloadCaptures.delete(web.id);}
module.exports = { getSourceSession,registerDownloadCapture };
