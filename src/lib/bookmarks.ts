export function sameReadingLocation(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const left = /^text:(\d+):([\d.]+)$/.exec(a), right = /^text:(\d+):([\d.]+)$/.exec(b);
  return !!left && !!right && left[1] === right[1] && Math.abs(Number(left[2]) - Number(right[2])) < .003;
}
