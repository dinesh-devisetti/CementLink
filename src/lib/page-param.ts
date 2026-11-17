import { MAX_PAGE } from "./validation/pagination";

/** ?page= from the URL: a whole number in 1..MAX_PAGE, anything else is page 1. */
export function pageParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}
