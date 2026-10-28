import type { Book } from '../types';
import { sampleEnglish } from '../lib/samples';

export function Cover({ book, className = '' }: { book: Book; className?: string }) {
  const variant = book.cover % 6;
  if (book.online?.coverUrl) return <div className={`book-cover imported-cover ${className}`}><img src={book.online.coverUrl} alt={`${book.title}封面`} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /><span className="online-cover-fallback">{book.title}</span></div>;
  if (book.coverImage) return <div className={`book-cover imported-cover ${className}`}><img src={book.coverImage} alt={`${book.title}封面`} /></div>;
  return <div className={`book-cover cover-${variant} ${className}`} aria-hidden="true">
    <svg className="cover-art" viewBox="0 0 180 252" fill="none">
      {variant === 0 && <>
        <circle cx="129" cy="123" r="27" fill="#e7bd73" />
        <path d="M0 169L39 121 76 163 111 140 180 180V252H0Z" fill="#858b79" />
        <path d="M0 184L55 148 86 186 132 151 180 176V252H0Z" fill="#576b64" />
        <path d="M0 196Q45 176 95 190T180 186V252H0Z" fill="#abc2bd" />
        <path d="M0 221Q49 207 98 218T180 213M15 238Q62 227 118 236M66 202h39m17 24h34" stroke="#dbe1ce" strokeWidth="1.2" />
        <path d="M16 185v-45m0 5-9 17h18zm0 12-13 21h26zM167 179v-55m0 7-10 19h20zm0 13-15 25h30z" fill="#314b43" stroke="#314b43" />
      </>}
      {variant === 1 && <>
        <path d="M87 253c-10-45 38-78 30-119M94 229c-35-12-62-49-63-78m63 67c39-12 54-37 54-68M88 249C68 207 54 204 45 202" stroke="#d4d5a6" strokeWidth="1.2" />
        <path d="M61 199c-28 0-42-23-28-41 20 4 33 17 28 41zm-7-22c-26-18-25-40-13-49 20 13 24 33 13 49zm50 31c-7-28 6-49 24-48 9 21-1 41-24 48zm18-31c-3-27 9-43 25-40 7 21-5 37-25 40zm-16 51c10-27 30-34 44-23-3 23-24 27-44 23zM80 245c-25 0-40-17-31-31 19 1 31 12 31 31z" fill="#a7b18c" />
        <path d="M111 157c-16-22-12-42 2-45 14 16 13 34-2 45z" fill="#c7c8a1" />
        <circle cx="146" cy="111" r="3" fill="#d6be83" />
      </>}
      {variant === 2 && <>
        <circle cx="87" cy="185" r="46" fill="#c68549" stroke="#f3d4a2" strokeWidth="1" />
        <ellipse cx="86" cy="192" rx="61" ry="12" transform="rotate(-20 86 192)" stroke="#f9e5bc" />
        <path d="M82 161v23m0-18-8 10m8-10 7 10m-7 8-6 10m6-10 5 10" stroke="#f8eacb" strokeWidth="2" strokeLinecap="round" />
        <circle cx="82" cy="157" r="4" fill="#f8eacb" />
        <path d="M87 165q17-9 21-3-16 7-21 3" fill="#af523e" />
        {[ [26,114], [145,127], [153,199], [37,219], [117,102] ].map(([x,y],i) => <path key={i} d={`M${x-3} ${y}h6m-3-3v6`} stroke="#fff0cb" />)}
        <circle cx="42" cy="141" r="1.5" fill="#f8eacb" /><circle cx="136" cy="222" r="1.5" fill="#f8eacb" />
      </>}
      {variant === 3 && <>
        <circle cx="54" cy="162" r="39" fill="#e1d1a3" />
        <circle cx="68" cy="147" r="35" fill="#2f5960" />
        <path d="M0 217Q40 184 79 213t101-13v52H0Z" fill="#376b6e" />
        <path d="M0 236q63-43 111-5t69-10v31H0Z" fill="#548184" />
        <path d="m129 189 1-70m-1 21-19-18m20 34 22-23m-23 39-27-18" stroke="#b2bca1" strokeWidth="1.2" />
        <path d="m126 126-22-20q2 25 22 20m7 21 28-25q-1 27-28 25m-6 19-30-24q0 28 30 24" fill="#809586" />
        <circle cx="143" cy="102" r="2" fill="#dbc998" />
      </>}
      {variant === 4 && <>
        <circle cx="90" cy="151" r="29" fill="#caa778" />
        <path d="M83 181c-3-17-8-27 1-32 3-2 8-2 11 0 9 5 4 15 1 32m-13-10-13 10h39l-13-10" fill="#6b5051" />
        <circle cx="89" cy="141" r="5" fill="#6b5051" />
        {[0,1,2,3,4,5,6].map(i => <path key={i} d={`M${10-i*2} ${191+i*9}q40 ${-12+i*2} 80 0t90 0`} stroke="#b78f78" strokeWidth=".7" opacity={1-i*.09} />)}
        <path d="M29 139q-5-13 0-26m123 42q9-22-1-38" stroke="#b99b77" />
      </>}
      {variant === 5 && <>
        <path d="M21 154q19-19 38 0-4-12-20-16 19-9 29-1-8-19-34-12l5 13q-18-5-18 16z" fill="#435d5b" />
        <path d="M92 133q16-16 32 0-4-10-17-13 16-8 25-1-8-16-29-10l4 11q-15-5-15 13z" fill="#9d604a" />
        <path d="M118 194q12-13 25 0-3-8-13-10 13-6 20-1-6-13-23-8l3 9q-12-3-12 10z" fill="#435d5b" />
        <path d="M22 236q55-22 139-7m-123-6q54-18 109-10" stroke="#baae8c" strokeWidth=".8" />
        <rect x="84" y="174" width="16" height="22" rx="1" stroke="#ac624b" /><path d="M88 181h8m-4-4v14m-4-5h8" stroke="#ac624b" />
      </>}
    </svg>
    <div className="cover-type">
      <div className="cover-edition">{book.sample ? 'THE READING COLLECTION' : 'QIDU · PERSONAL LIBRARY'}</div>
      <div className="cover-title">{book.sample && variant === 3 ? <>月亮与<br />六便士</> : book.title}</div>
      <div className="cover-subtitle">{book.sample ? sampleEnglish[variant] : book.format + ' EDITION'}</div>
      <div className="cover-author">{book.author}</div>
    </div>
    <div className="cover-spine" />
    <div className="cover-publisher">栖 读 · {book.sample ? '导 读' : '藏 书'}</div>
  </div>;
}

export function Sprig({ className = '' }: { className?: string }) {
  return <svg className={className} width="180" height="200" viewBox="0 0 180 200" fill="none" aria-hidden="true">
    <path d="M87 200c-9-57 26-107 42-156M91 172C58 143 42 108 36 69m66 75c28-19 45-42 50-70m-60 110c-32-14-52-32-63-59" stroke="currentColor" strokeWidth="1.5" />
    <path d="M110 113c-12-30-4-53 17-59 9 27 1 47-17 59zm-12 30c3-28 21-44 42-39-3 26-17 39-42 39zm-24-1c-30-8-45-31-36-51 25 11 40 27 36 51zm-21-35c-21-11-32-35-24-52 25 10 33 30 24 52zm37 66c9-26 27-34 48-24-10 23-24 28-48 24zm-22 1c-28 1-47-19-43-36 24 0 39 14 43 36zm57-97c-3-29 10-51 28-53 6 28-10 45-28 53z" stroke="currentColor" strokeWidth="1.3" />
  </svg>;
}
