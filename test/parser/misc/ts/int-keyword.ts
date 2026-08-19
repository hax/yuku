// `int` is a contextual primitive type keyword, sibling of `number`.
let count: int = 1;
const zero: int = 0;

function twice(value: int): int {
    return value * 2;
}

function sum(values: Array<int>): int {
    return values.length;
}

type Primary = int;
type Boxed = { value: int };
interface Point {
    x: int;
    y: int;
}

class Counter<T extends int> {
    total: int = 0;
}

abstract class Shape {
    abstract sides(): int;
}

const satisfiesInt = zero satisfies int;
const asserted = zero as int;

// `int` stays a valid identifier and member name.
let int = 1;
int = int + 1;
const holder = { int: 2 };
holder.int;
function takesInt(int: number) {
    return int;
}

// `int` followed by `.` is a qualified type reference, not the keyword.
declare const ns: { point: { x: number } };
type FromNamespace = ns.point;
