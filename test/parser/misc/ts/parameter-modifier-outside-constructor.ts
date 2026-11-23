// Parameter-property modifiers outside constructor implementations are recoverable:
// the parser consumes the modifiers, keeps the real parameter and function ASTs, and
// reports a dedicated early error per parameter (tsc TS2369, anchored on the whole
// parameter from the first modifier token). Constructor implementations keep the
// parameter-property shorthand, and a modifier word that is not followed by a
// parameter start stays a plain parameter name.
function f1(private x: number) {}
function f2(readonly x) {}
function f3(private readonly x: number) {}
function f4(override x: number) {}
function f5(public x: number, protected y: string) {}
function f6(readonly ...rest: number[]) {}
const g = (private x: number) => x;
const h = (readonly x) => x;
const k = async (private x: number): Promise<number> => x;
class C {
  m(readonly x: number) {}
  constructor(private y: string) {}
  n(readonly z: number): void {}
  static s(readonly w: number) {}
}
interface I {
  m(readonly x: number);
  new (readonly x: number): void;
}
declare class D {
  c(readonly x: number);
  m(readonly x: number);
}
const o = { m(private x: number) {} };
type T = (private x: number) => void;
type U = new (readonly x: number) => void;
function f7(private {a}: {a: number}) {}
function f8(private) {}
function f9(private = 1) {}
class E {
  get p() {
    return 1;
  }
}
// Parenthesized readonly array/tuple types keep their type readings; only a
// real parameter start followed by `:`/`?`/`,`/`=`/`) =>` reads as a function type.
let only: (readonly string[])[] | undefined;
function cartesian<T>(arrays: readonly (readonly T[])[], result: (readonly T[])[]) {
  return arrays;
}
// `as` after a modifier keeps the binary-expression reading (tsc cites #44466);
// a typed parameter named `as` still commits, in value and type positions.
const q = (readonly as number);
const q2 = (readonly as: number) => q;
type U2 = (readonly as: number) => void;
// async heads parse committed; a failed head recovers at the statement level.
const e = async (readonly x);
const afterAsync = 1;
// multi modifier rest parameters report the rest and modifier errors together.
function f10(public readonly ...rest: number[]) {}
