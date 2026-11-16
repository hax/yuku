// A non-simple assignment target in a prefix or postfix update expression is an
// early error. The parser keeps the `update_expression` node after reporting it,
// so callers can still see the operand and report the type-level diagnostics tsc
// reports for the same shape (TS2356/TS2357). Keeping the node also keeps error
// recovery from swallowing the statements that follow.

++"";
""--;
++1;
++(a + b);
f()++;

// The statement after an invalid update expression still parses.
"".trim();
