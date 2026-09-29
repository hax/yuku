import pathlib
T = "4"
p = pathlib.Path('./src/parser/lexer.zig')
s = p.read_text()
old = """        var pos = start + 1;
        while (pos + 16 <= src.len) {
            const run = identContinueRun(Simd.loadChunk(src, pos));
            pos += run;
            if (run < 16) break;
        } else {
            while (pos < src.len and ident_continue_table_ascii[src[pos]]) {
                pos += 1;
            }
        }"""
new = f"""        var pos = start + 1;
        while (pos < src.len and pos - start < {T} and ident_continue_table_ascii[src[pos]]) {{
            pos += 1;
        }}
        if (pos - start == {T}) {{
            while (pos + 16 <= src.len) {{
                const run = identContinueRun(Simd.loadChunk(src, pos));
                pos += run;
                if (run < 16) break;
            }} else {{
                while (pos < src.len and ident_continue_table_ascii[src[pos]]) {{
                    pos += 1;
                }}
            }}
        }}"""
if s.count(old) != 1:
    sys.exit(f"anchor count={s.count(old)}")
p.write_text(s.replace(old, new))
print(f"T={T} applied")
