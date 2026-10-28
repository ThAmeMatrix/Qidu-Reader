export type BookFormat = 'TXT' | 'EPUB' | 'PDF' | 'HTML' | 'MD' | 'WEB';
export type ReadingStatus = 'reading' | 'want' | 'finished';
export type Page = 'library' | 'discover' | 'reviews' | 'notes' | 'stats' | 'settings';
export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  status: ReadingStatus;
  progress: number;
  location?: string;
  cover: number;
  coverImage?: string;
  collectionIds: string[];
  addedAt: number;
  lastRead?: number;
  size: number;
  fingerprint?: string;
  sample?: boolean;
  sourceUrl?: string;
  description?: string;
  favorite?: boolean;
  online?: RemoteBook;
  cache?: {downloadId?:string; name:string; loadedAt:number};
  cacheSource?: DownloadRequest;
}
export interface SourceSelectors { item: string; title: string; link: string; author: string; cover: string; description: string; next: string }
export interface BookSource {
  id: string; name: string; homepage: string; enabled: boolean;
  adapter: 'generic' | 'youshu' | 'qidian' | 'zongheng' | 'nlc' | 'linovelib' | 'novelia' | 'fanqie' | 'ciweimao';
  searchUrl: string; browseUrl?: string; method: 'GET' | 'POST'; body?: string;
  charset: 'auto' | 'utf-8' | 'gb18030'; selectors?: Partial<SourceSelectors>;
  builtin?: boolean; description?: string; revision?: number;
  searchMode?: 'http' | 'auto' | 'browser';
}
export interface RemoteBook { sourceId: string; sourceName: string; url: string; title: string; author: string; description: string; coverUrl?: string; tags?: string[] }
export interface DownloadProvider {
  id: string; name: string; homepage: string; searchUrl: string; enabled: boolean;
  adapter: 'link' | 'archive' | 'gutenberg'; kind: 'engine' | 'catalog' | 'site'; description?: string;
  selectors?: Partial<Pick<SourceSelectors, 'item' | 'title' | 'link' | 'description' | 'next'>>;
}
export interface DownloadTarget { title: string; author: string; url?: string; sourceName?: string; bookId?:string; work?:RemoteBook; initialUrl?:string }
export type DownloadFileFormat = 'EPUB'|'PDF'|'TXT'|'ZIP'|'RAR'|'7Z';
export interface DownloadRequest { url:string; name:string; format:DownloadFileFormat; referrer?:string; bookTitle:string; bookAuthor:string; resourceId?:string; fileIndex?:number; source?:'torrent'|'browser'; cloudUrl?:string; cloudPassword?:string; bookId?:string; work?:RemoteBook; autoLoad?:boolean; preparedId?:string }
export interface DownloadJob extends DownloadRequest { archive?:{name:string;format:'ZIP'|'RAR'|'7Z'}; id:string; status:'queued'|'downloading'|'completed'|'failed'|'cancelled'; received:number; total?:number; error?:string; createdAt:number; peers?:number; speed?:number }
export interface TorrentFile {index:number;name:string;size:number;format?:DownloadFileFormat;available:boolean}
export interface TorrentResource {id:string;url:string;infoHash:string;name:string;files:TorrentFile[]}
export interface CloudContext {id:string;url:string;password?:string;bookTitle:string;bookAuthor:string;resolve?:boolean;restart?:boolean;bookId?:string;work?:RemoteBook}
export interface SourceRequest { url: string; method?: 'GET' | 'POST'; body?: string; charset?: 'auto' | 'utf-8' | 'gb18030'; referrer?: string; render?: boolean; readySelector?: string; downloadPage?: boolean }
export interface SourceResponse { text: string; url: string; status: number; contentType: string; rendered?: boolean; access?: 'login' | 'verification'; download?: {name:string;format:DownloadFileFormat} }
export interface SourceSnapshot extends SourceResponse { sourceId: string; mode: 'search' | 'detail' }
export interface Chapter { id: string; title: string; html: string }
export interface BookPayload { id: string; blob?: Blob; chapters?: Chapter[] }
export interface Review { id: string; bookId: string; rating: number; title: string; body: string; updatedAt: number }
export interface Note { id: string; bookId: string; kind: 'highlight' | 'bookmark'; text: string; comment?: string; location: string; progress: number; createdAt: number }
export interface Collection { id: string; name: string; color: string }
export interface ReaderSettings { theme: 'paper' | 'light' | 'dark' | 'green'; font: 'serif' | 'sans'; fontSize: number; lineHeight: number; width: number }
export interface Settings { reader: ReaderSettings; dailyGoal: number; appTheme: 'light' | 'dark'; reduceMotion: boolean }
export interface LibraryState { version: 1; books: Book[]; reviews: Review[]; notes: Note[]; collections: Collection[]; settings: Settings; readingSeconds: Record<string, number>; sources?: BookSource[]; sourceCatalogVersion?: number; searchHistory?: string[]; downloadProviders?: DownloadProvider[] }
export interface ImportedFile { name: string; data: Uint8Array }
declare global {
  interface Window {
    desktop?: {
      pickFiles: () => Promise<ImportedFile[]>;
      fetchArticle: (url: string) => Promise<{ html: string; url: string }>;
      fetchSource: (request: SourceRequest) => Promise<SourceResponse>;
      openSource: (source: { id: string; name: string; homepage?: string }, request: SourceRequest, mode: 'search' | 'detail') => Promise<void>;
      onSourceSnapshot: (callback: (snapshot: SourceSnapshot) => void) => () => void;
      onSourceRetry: (callback: (sourceId: string) => void) => () => void;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      fullscreen: () => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      downloads: {
        resolveTorrent: (request:{url:string;id:string})=>Promise<TorrentResource>;
        cancelResolution: (id:string)=>Promise<void>;
        onPrepared: (callback:(value:{contextId:string;file:DownloadRequest})=>void)=>()=>void;
        onResolveStatus: (callback:(value:{contextId:string;message:string;done?:boolean})=>void)=>()=>void;
        stopCloud: (id:string)=>Promise<void>;
        setCloudContext: (id:string,active:boolean)=>Promise<void>;
        openCloud: (context:CloudContext)=>Promise<void>;
        onPage: (callback:(page:SourceResponse & {contextId:string})=>void)=>()=>void;
        list: () => Promise<DownloadJob[]>;
        start: (request:DownloadRequest) => Promise<DownloadJob>;
        cancel: (id:string) => Promise<void>;
        retry: (id:string) => Promise<void>;
        read: (id:string) => Promise<ImportedFile>;
        save: (id:string) => Promise<boolean>;
        extract: (request:{id:string;password?:string})=>Promise<DownloadJob>;
        acknowledge: (id:string)=>Promise<void>;
        remove: (id:string) => Promise<void>;
        onChange: (callback:(jobs:DownloadJob[])=>void) => () => void;
      };
      platform: string;
    };
  }
}
