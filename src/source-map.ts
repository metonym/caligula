import { CLOSE_CURLY, COMMA, CR, FF, LF, OPEN_CURLY, SEMICOLON } from "./chars";

const BASE64 = new TextEncoder().encode(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
);

function isNewline(css: string, i: number): boolean {
  const code = css.charCodeAt(i);
  if (code === LF || code === FF) return true;
  return code === CR && css.charCodeAt(i + 1) !== LF;
}

export class SourceMapBuilder {
  private lineStarts: number[];
  private bytes = new Uint8Array(1024);
  private length = 0;
  private lineEmpty = true;
  private genColumn = 0;
  private prevGenColumn = 0;
  private prevSrcLine = 0;
  private prevSrcColumn = 0;
  private srcLineHint = 0;

  constructor(css: string) {
    const starts = [0];
    for (let i = 0; i < css.length; i++) {
      if (isNewline(css, i)) starts.push(i + 1);
    }
    this.lineStarts = starts;
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    const bytes = new Uint8Array(
      Math.max(this.bytes.length * 2, this.length + extra),
    );
    bytes.set(this.bytes.subarray(0, this.length));
    this.bytes = bytes;
  }

  private vlq(value: number): void {
    let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
    const bytes = this.bytes;
    do {
      let digit = vlq & 31;
      vlq >>>= 5;
      if (vlq > 0) digit |= 32;
      bytes[this.length++] = BASE64[digit];
    } while (vlq > 0);
  }

  private segment(offset: number): void {
    const starts = this.lineStarts;
    let lo = this.srcLineHint;
    if (starts[lo] <= offset) {
      while (lo + 1 < starts.length && starts[lo + 1] <= offset) lo++;
    } else {
      lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
    }
    this.srcLineHint = lo;
    const srcLine = lo;
    const srcColumn = offset - starts[lo];

    this.reserve(29);
    if (!this.lineEmpty) this.bytes[this.length++] = COMMA;
    this.lineEmpty = false;
    this.vlq(this.genColumn - this.prevGenColumn);
    this.vlq(0);
    this.vlq(srcLine - this.prevSrcLine);
    this.vlq(srcColumn - this.prevSrcColumn);
    this.prevGenColumn = this.genColumn;
    this.prevSrcLine = srcLine;
    this.prevSrcColumn = srcColumn;
  }

  private newline(): void {
    this.reserve(1);
    this.bytes[this.length++] = SEMICOLON;
    this.lineEmpty = true;
    this.genColumn = 0;
    this.prevGenColumn = 0;
  }

  copy(css: string, from: number, to: number): void {
    if (from >= to) return;
    this.segment(from);
    for (let i = from; i < to; i++) {
      if (isNewline(css, i)) {
        this.newline();
        if (i + 1 < to) this.segment(i + 1);
        continue;
      }
      this.genColumn++;
      const code = css.charCodeAt(i);
      if (
        (code === OPEN_CURLY || code === CLOSE_CURLY || code === SEMICOLON) &&
        i + 1 < to &&
        !isNewline(css, i + 1)
      ) {
        this.segment(i + 1);
      }
    }
  }

  insert(text: string, origin: number): void {
    if (text === "") return;
    this.segment(origin);
    for (let i = 0; i < text.length; i++) {
      if (isNewline(text, i)) this.newline();
      else this.genColumn++;
    }
  }

  mappings(): string {
    return new TextDecoder().decode(this.bytes.subarray(0, this.length));
  }
}
