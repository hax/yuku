const std = @import("std");
const Token = @import("token.zig").Token;
const TokenTag = @import("token.zig").TokenTag;
const flagMask = @import("token.zig").flagMask;
const lexer = @import("lexer.zig");
const ast = @import("ast.zig");
const spec = @import("spec");
const util = @import("util");

/// Whether the experimental batch lexing strategy is compiled in
/// (`-Dbatch-lexing`). When false, every batch code path folds away at
/// comptime and the parser is exactly the on-demand one.
pub const batch_lexing: bool = @import("parser_options").batch_lexing;

const statements = @import("syntax/statements.zig");
const Speculation = @import("syntax/ts/speculation.zig").Speculation;
const grammar = @import("grammar.zig");
const comments = @import("comments.zig");

/// How comments are collected and attached to their nodes.
pub const CommentMode = enum { none, collect, attach };

/// Where the parser gets its tokens.
pub const LexStrategy = enum {
    /// The parser drives the lexer, scanning tokens on demand.
    on_demand,
    /// Tokens are scanned up front into an array, which the parser then reads.
    /// Experimental: the array comes from a collecting on-demand pass, so this
    /// measures the shape of parsing from pre-scanned tokens, not a new lexer.
    batch,
};

pub const Options = struct {
    /// How the source is parsed. `.commonjs` treats the top level as a function body.
    source_type: ast.SourceType = .module,
    /// Language variant that decides which syntax features are enabled.
    lang: ast.Lang = .js,
    /// Whether parenthesized expressions are kept as `ParenthesizedExpression` nodes.
    preserve_parens: bool = true,
    /// Whether comments are collected, and attached to their nodes.
    comments: CommentMode = .collect,
    /// Whether to keep every consumed token in `Tree.tokens`.
    tokens: bool = false,
    /// Where the parser gets its tokens.
    lex_strategy: LexStrategy = .on_demand,
};

pub const Context = packed struct {
    /// `[Yield]`
    yield: bool = false,
    /// `[Await]`
    await: bool = false,
    /// `[Return]`
    @"return": bool = false,
    /// Body of `if`, `do`, `while`, `for`, `with`, or a labelled statement, where lexical
    /// declarations need a block.
    single_statement: bool = false,
    /// Inside a directive prologue.
    directive_prologue: bool = false,
};

pub const TsContext = packed struct {
    /// Inside a `declare`-prefixed declaration or a `.d.ts` file, where nested declarations
    /// inherit ambient rules.
    ambient: bool = false,
    /// A trailing `?` after a type does not start a new conditional.
    disallow_conditional_types: bool = false,
};

const ParserState = struct {
    // `{ a = 1 }` defaults not yet part of a pattern, any left at the end are errors
    cover_init_names: u32 = 0,
    // `(a) = b` is legal, but the same node is a syntax error in binding position
    stripped_paren: ?ast.NodeIndex = null,
};

pub const Error = error{};

pub const Parser = struct {
    tree: ast.Tree,
    source: []const u8,
    preserve_parens: bool,
    comment_mode: CommentMode,
    collect_tokens: bool,
    lexer: lexer.Lexer,
    diagnostics: std.ArrayList(ast.Diagnostic) = .empty,
    tokens: std.ArrayList(Token) = .empty,

    current_token: Token,
    // spans must stop at a consumed delimiter, not at the next token past trivia
    prev_token_end: u32 = 0,

    scratch_statements: ScratchBuffer = .{},
    scratch_cover: ScratchBuffer = .{},
    scratch_decorators: ScratchBuffer = .{},

    scratch_a: ScratchBuffer = .{},
    scratch_b: ScratchBuffer = .{},
    scratch_string: std.ArrayList(u8) = .empty,

    context: Context = .{},
    ts_context: TsContext = .{},
    state: ParserState = .{},

    ts_rejected_speculations: std.AutoHashMapUnmanaged(Speculation, void) = .empty,

    // batch lexing: the pre-scanned stream, the read cursor into it, and the
    // comments the collecting pass recorded
    token_array: ?[]const Token = null,
    read_index: u32 = 0,
    carried_comments: []const ast.Comment = &.{},
    // a split shift token (`>>` into `>` + `>`) replays on the lexer until its
    // output lands back on an array boundary; only doomed speculation splits,
    // since a successful angle-bracket parse committed the split tokens
    array_window: bool = false,

    pub inline fn allocator(self: *Parser) std.mem.Allocator {
        return self.tree.allocator();
    }

    /// Whether this parser reads a pre-scanned token array. Comptime-false
    /// unless built with `-Dbatch-lexing`, so the default build keeps no
    /// batch code at all.
    pub inline fn batchMode(self: *const Parser) bool {
        return batch_lexing and self.token_array != null;
    }

    fn parse(self: *Parser) Error!ast.Tree {
        errdefer self.tree.arena.deinit();

        self.lexer = lexer.Lexer.init(
            self.source,
            self.allocator(),
            self.tree.source_type,
            self.comment_mode != .none,
        );
        self.lexer.fast_path = !self.collect_tokens;

        // ScriptBody is [~Yield, ~Await, ~Return], ModuleItemList is [+Await], and a
        // commonjs body is [+Return]
        self.context.await = self.tree.isModule();
        self.context.@"return" = self.tree.source_type == .commonjs;
        self.ts_context.ambient = self.tree.lang == .dts;

        try self.advance() orelse {
            self.current_token = try self.recoverNextToken();
        };

        self.ensureCapacity() catch ast.outOfMemory();

        const body = try self.parseBody(null, .program);
        if (self.state.cover_init_names > 0) try grammar.reportCoverInitializedNames(self);

        std.debug.assert(self.current_token.tag == .eof);
        if (self.collect_tokens) self.tokens.append(self.allocator(), self.current_token) catch ast.outOfMemory();

        self.tree.root = try self.tree.addNode(.{ .program = .{
            .source_type = if (self.tree.source_type == .module) .module else .script,
            .body = body,
            .hashbang = if (self.lexer.hashbang) |h| .{
                .value = self.tree.sourceSlice(h.start, h.start + h.len),
            } else null,
        } }, .{ .start = 0, .end = self.current_token.span.end });

        self.tree.diagnostics = self.diagnostics;
        if (!self.preserve_parens) stripParenthesizedNodes(&self.tree);
        if (self.batchMode()) {
            // attach mutates the list, so the carried comments need a private copy
            if (self.comment_mode == .attach) {
                const collected = self.allocator().dupe(ast.Comment, self.carried_comments) catch ast.outOfMemory();
                comments.attach(&self.tree, collected) catch ast.outOfMemory();
                self.tree.comments = collected;
            } else {
                self.tree.comments = self.carried_comments;
            }
            self.tree.tokens = self.token_array.?;
        } else {
            const collected = self.lexer.comments.items;
            if (self.comment_mode == .attach) comments.attach(&self.tree, collected) catch ast.outOfMemory();
            self.tree.comments = collected;
            if (self.collect_tokens) self.tree.tokens = self.tokens.items;
        }
        return self.tree;
    }

    inline fn commitToken(self: *Parser, token: Token) Error!void {
        if (!self.collect_tokens) return;
        // the initial placeholder or an empty jsx text run
        if (token.span.start == token.span.end) return;
        if (self.tokens.items.len < self.tokens.capacity) {
            self.tokens.appendAssumeCapacity(token);
        } else {
            self.tokens.append(self.allocator(), token) catch ast.outOfMemory();
        }
    }

    pub const BodyKind = enum { program, function, module_block, other };

    pub fn parseBody(self: *Parser, terminator: ?TokenTag, kind: BodyKind) Error!ast.IndexRange {
        self.context.directive_prologue = kind != .other;
        defer self.context.directive_prologue = false;

        const statements_checkpoint = self.scratch_statements.begin();
        defer self.scratch_statements.reset(statements_checkpoint);

        while (self.current_token.tag != .eof and self.current_token.tag != terminator) {
            if (try statements.parseStatement(self, .{ .body = kind })) |statement| {
                try self.scratch_statements.append(self.allocator(), statement);
            } else {
                try self.recover(terminator);
            }
        }

        return self.flushToExtras(&self.scratch_statements, statements_checkpoint);
    }

    /// Returns the resolved name of an identifier-like token, without a private `#` and
    /// with escapes decoded.
    pub inline fn identifierName(self: *Parser, token: Token) Error!ast.String {
        const is_private = token.tag == .private_identifier;
        const start = token.span.start + @as(u32, @intFromBool(is_private));
        if (token.isEscaped()) return self.decodeEscapedIdentifier(start, token.span.end);
        return self.tree.sourceSlice(start, token.span.end);
    }

    /// Returns the escape-decoded text of a string or template element, without its delimiters.
    pub inline fn stringValue(self: *Parser, token: Token, span: ast.Span) Error!ast.String {
        if (!token.isEscaped()) return self.tree.sourceSlice(span.start, span.end);
        return self.decode(spec.escapes.decodeStringEscapes, span.start, span.end);
    }

    /// Returns JSX text or the inside of a JSX attribute string with its entities decoded.
    pub inline fn jsxValue(self: *Parser, start: u32, end: u32) Error!ast.String {
        if (std.mem.findScalar(u8, self.source[start..end], '&') == null) {
            return self.tree.sourceSlice(start, end);
        }
        return self.decode(spec.jsx_entities.decodeJSXEntities, start, end);
    }

    fn decodeEscapedIdentifier(self: *Parser, start: u32, end: u32) Error!ast.String {
        @branchHint(.cold);
        var buf: [256]u8 = undefined;
        return try self.tree.addString(
            spec.escapes.decodeIdentifierEscapes(self.source[start..end], &buf),
        );
    }

    fn decode(self: *Parser, comptime decoder: anytype, start: u32, end: u32) Error!ast.String {
        @branchHint(.cold);
        const alloc = self.allocator();
        self.scratch_string.clearRetainingCapacity();
        decoder(alloc, self.source[start..end], &self.scratch_string) catch ast.outOfMemory();
        return try self.tree.addString(self.scratch_string.items);
    }

    pub fn describeToken(self: *Parser, token: Token) Error![]const u8 {
        if (token.tag == .eof) return "end of file";
        const text = token.tag.toString() orelse token.text(self.source);
        if (text.len > 0 and (text[0] == '\'' or text[0] == '"' or text[0] == '`')) return text;
        return self.fmt("'{s}'", .{text});
    }

    pub inline fn setLexerMode(self: *Parser, mode: lexer.LexerMode) void {
        // the array was scanned with the right modes already; the rescan window
        // still serves from the lexer, which needs the real mode
        if (batch_lexing and self.token_array != null and !self.array_window) return;
        self.lexer.mode = mode;
        self.lexer.fast_path = mode == .normal and !self.collect_tokens;
    }

    pub fn flushToExtras(
        self: *Parser,
        scratch: *ScratchBuffer,
        scratch_checkpoint: usize,
    ) Error!ast.IndexRange {
        return self.tree.addExtra(scratch.items.items[scratch_checkpoint..]);
    }

    pub inline fn spanText(self: *const Parser, span: ast.Span) []const u8 {
        return self.source[span.start..span.end];
    }

    inline fn nextTokenInto(self: *Parser, out: *Token) Error!bool {
        self.lexer.nextTokenInto(out) catch |e| {
            if (e == error.OutOfMemory) ast.outOfMemory();
            try self.reportLexicalError(@errorCast(e));
            return false;
        };
        return true;
    }

    pub noinline fn reportLexicalError(self: *Parser, lex_err: lexer.LexicalError) Error!void {
        @branchHint(.cold);
        const cursor = self.lexer.cursor;
        std.debug.assert(cursor <= self.source.len);
        const width: u32 = if (cursor == self.source.len)
            0
        else if (util.Utf.codePointAt(self.source, cursor)) |code_point|
            code_point.len
        else |_|
            1;
        try self.report(
            .{ .start = cursor, .end = cursor + width },
            lexer.getLexicalErrorMessage(lex_err),
            .{ .help = lexer.getLexicalErrorHelp(lex_err) },
        );
    }

    /// Advances to the next token, reporting an escaped keyword consumed in keyword position.
    pub inline fn advance(self: *Parser) Error!?void {
        const token = self.current_token;
        if (token.isEscaped()) {
            if (token.tag.isKeyword()) try self.reportEscapedKeyword(token.span);
        }
        return self.advanceWithoutEscapeCheck();
    }

    /// Advances without the escaped-keyword check.
    pub inline fn advanceWithoutEscapeCheck(self: *Parser) Error!?void {
        self.prev_token_end = self.current_token.span.end;
        if (self.batchMode()) {
            @branchHint(.unlikely);
            const array = self.token_array.?;
            if (!self.array_window) {
                self.current_token = self.arrayNext(array);
                return;
            }
            // the window serves from the lexer until it realigns with the array
            return self.advanceThroughWindow(array);
        }
        if (self.lexer.tryNextToken(&self.current_token)) return;
        const leaving = self.current_token;
        if (!try self.nextTokenInto(&self.current_token)) return null;
        try self.commitToken(leaving);
    }

    /// Drops array entries the window already produced, then leaves the window
    /// when the lexer lands exactly on an array boundary.
    inline fn realignArrayWindow(self: *Parser, array: []const Token) void {
        while (self.read_index < array.len - 1 and
            array[self.read_index].span.end <= self.lexer.cursor)
        {
            self.read_index += 1;
        }
        if (self.lexer.mode == .normal and array[self.read_index].span.start == self.lexer.cursor) {
            self.array_window = false;
        }
    }

    /// Serves the next token from the lexer while the rescan window is open,
    /// realigning with the array when the scanner lands on a boundary.
    noinline fn advanceThroughWindow(self: *Parser, array: []const Token) Error!?void {
        self.realignArrayWindow(array);
        if (!self.array_window) {
            self.current_token = self.arrayNext(array);
            return;
        }
        if (!self.lexer.tryNextToken(&self.current_token)) {
            if (!try self.nextTokenInto(&self.current_token)) return null;
        }
    }

    /// The next unread token of the array, clamped at its trailing `eof`.
    inline fn arrayNext(self: *Parser, array: []const Token) Token {
        if (self.read_index < array.len - 1) {
            defer self.read_index += 1;
            return array[self.read_index];
        }
        return array[array.len - 1];
    }

    pub noinline fn reportEscapedKeyword(self: *Parser, span: ast.Span) Error!void {
        @branchHint(.cold);
        try self.report(span, "Keywords cannot contain escape characters", .{
            .help = "Write the keyword without escapes",
        });
    }

    /// Reports an escaped-keyword error for a token consumed before its role was known.
    pub inline fn reportIfEscapedKeyword(self: *Parser, token: Token) Error!void {
        if (token.isEscaped()) try self.reportEscapedKeyword(token.span);
    }

    /// Peeks the token after `current_token` without advancing. Use `beginPeek` for
    /// multi-token lookahead.
    pub inline fn peekAhead(self: *Parser) Token {
        if (self.batchMode() and !self.array_window) {
            const array = self.token_array.?;
            return array[@min(self.read_index, array.len - 1)];
        }
        var peek = self.beginPeek();
        defer peek.end();
        return peek.next();
    }

    /// Captures a snapshot of parser state for `rewind`.
    pub fn checkpoint(self: *const Parser) Checkpoint {
        return .{
            .lexer_cursor = self.lexer.cursor,
            .lexer_state = self.lexer.state,
            .lexer_mode = self.lexer.mode,
            .lexer_comments_len = self.lexer.comments.items.len,
            .current_token = self.current_token,
            .prev_token_end = self.prev_token_end,
            .read_index = if (batch_lexing) self.read_index else 0,
            .array_window = if (batch_lexing) self.array_window else false,
            .nodes_len = self.tree.nodes.len,
            .extras_len = self.tree.extras.items.len,
            .diagnostics_len = self.diagnostics.items.len,
            .tokens_len = self.tokens.items.len,
            .context = self.context,
            .ts_context = self.ts_context,
            .state = self.state,
        };
    }

    /// Restores parser state captured by `checkpoint`.
    pub fn rewind(self: *Parser, cp: Checkpoint) void {
        self.lexer.cursor = cp.lexer_cursor;
        self.lexer.state = cp.lexer_state;
        self.setLexerMode(cp.lexer_mode);
        self.lexer.comments.shrinkRetainingCapacity(cp.lexer_comments_len);
        self.current_token = cp.current_token;
        self.prev_token_end = cp.prev_token_end;
        if (batch_lexing) {
            self.read_index = cp.read_index;
            self.array_window = cp.array_window;
        }
        self.tree.nodes.shrinkRetainingCapacity(cp.nodes_len);
        self.tree.extras.shrinkRetainingCapacity(cp.extras_len);
        self.diagnostics.shrinkRetainingCapacity(cp.diagnostics_len);
        self.tokens.shrinkRetainingCapacity(cp.tokens_len);
        self.context = cp.context;
        self.ts_context = cp.ts_context;
        self.state = cp.state;
    }

    pub const Peek = struct {
        parser: *Parser,
        state: lexer.LexerState,
        cursor: u32,
        comments_len: usize,
        read_index: u32,

        pub inline fn next(self: *Peek) Token {
            const parser = self.parser;
            if (batch_lexing) {
                if (parser.token_array) |array| {
                    @branchHint(.unlikely);
                    if (!parser.array_window) {
                        const index = @min(parser.read_index, array.len - 1);
                        parser.read_index = index + 1;
                        return array[index];
                    }
                }
            }
            var token: Token = undefined;
            if (parser.lexer.tryNextToken(&token)) return token;
            return parser.lexer.nextToken() catch Token.invalid(parser.lexer.cursor);
        }

        pub inline fn end(self: Peek) void {
            self.parser.lexer.state = self.state;
            self.parser.lexer.cursor = self.cursor;
            self.parser.lexer.comments.shrinkRetainingCapacity(self.comments_len);
            if (batch_lexing) self.parser.read_index = self.read_index;
        }
    };

    pub inline fn beginPeek(self: *Parser) Peek {
        return .{
            .parser = self,
            .state = self.lexer.state,
            .cursor = self.lexer.cursor,
            .comments_len = self.lexer.comments.items.len,
            .read_index = if (batch_lexing) self.read_index else undefined,
        };
    }

    /// Replaces the current token with a re-scanned one and advances past it.
    pub inline fn advanceWithRescannedToken(self: *Parser, token: Token) Error!?void {
        if (self.batchMode()) {
            // in array mode only doomed speculation still rescans (angle-bracket
            // splits, or regex/template rescans while the window is active);
            // the lexer is left mid-stream, so the window replays until it
            // realigns with the array
            var rescanned = token;
            if (token.span.start < self.current_token.span.end) {
                std.debug.assert(token.span.start == self.current_token.span.start);
                rescanned.flags |= newlineFlag(self.current_token);
                self.array_window = true;
            } else {
                std.debug.assert(self.array_window);
            }
            self.current_token = rescanned;
            return self.advance();
        }
        var rescanned = token;
        // a rescan past the current token completes it, one inside it supersedes it
        if (token.span.start >= self.current_token.span.end) {
            try self.commitToken(self.current_token);
        } else {
            rescanned.flags |= newlineFlag(self.current_token);
        }
        self.current_token = rescanned;
        return self.advance();
    }

    /// Re-tokenizes the current token in the current lexer mode.
    pub inline fn reScanCurrent(self: *Parser) Error!?void {
        // outside the rescan window the collected stream already holds the
        // mode-rescanned token
        std.debug.assert(!self.batchMode() or self.array_window);
        const replaced = self.current_token;
        self.lexer.rewindTo(replaced.span.start);
        if (!try self.nextTokenInto(&self.current_token)) return null;
        self.current_token.flags |= newlineFlag(replaced);
    }

    // a rescan starts at the token it replaces, past the trivia that set the flag
    inline fn newlineFlag(token: Token) u8 {
        return token.flags & flagMask(.line_terminator_before);
    }

    pub fn expect(
        self: *Parser,
        comptime tag: TokenTag,
        message: []const u8,
        help: ?[]const u8,
    ) Error!bool {
        if (self.current_token.tag == tag) {
            try self.advance() orelse return false;
            return true;
        }
        try self.reportExpected(self.current_token.span, message, .{ .help = help });
        return false;
    }

    pub fn eatSemicolon(self: *Parser, end: u32) Error!?u32 {
        if (self.current_token.tag == .semicolon) {
            const semicolon_end = self.current_token.span.end;
            try self.advance() orelse return null;
            return semicolon_end;
        }
        if (self.canInsertImplicitSemicolon(self.current_token)) return end;
        try self.reportExpected(self.current_token.span, "Expected ';' after the statement", .{
            .help = "Add ';' or a line break before it",
        });
        return null;
    }

    /// https://tc39.es/ecma262/#sec-rules-of-automatic-semicolon-insertion
    pub inline fn canInsertImplicitSemicolon(_: *Parser, token: Token) bool {
        return token.tag == .eof or token.hasLineTerminatorBefore() or token.tag == .right_brace;
    }

    fn stripParenthesizedNodes(tree: *ast.Tree) void {
        const datas = tree.nodes.items(.data);
        const spans = tree.nodes.items(.span);
        for (0..datas.len) |i| {
            var inner: u32 = @intCast(i);
            while (true) {
                inner = switch (datas[inner]) {
                    .parenthesized_expression => |p| @backingInt(p.expression),
                    .ts_parenthesized_type => |p| @backingInt(p.type_annotation),
                    else => break,
                };
            }
            if (inner == i) continue;
            datas[i] = datas[inner];
            spans[i] = spans[inner];
        }
    }

    pub const ReportOptions = struct {
        severity: ast.Severity = .@"error",
        help: ?[]const u8 = null,
        labels: []const ast.Label = &.{},
    };

    pub fn report(
        self: *Parser,
        span: ast.Span,
        message: []const u8,
        opts: ReportOptions,
    ) Error!void {
        self.diagnostics.append(self.allocator(), .{
            .severity = opts.severity,
            .message = message,
            .span = span,
            .help = opts.help,
            .labels = opts.labels,
        }) catch ast.outOfMemory();
    }

    pub fn reportExpected(
        self: *Parser,
        span: ast.Span,
        message: []const u8,
        opts: ReportOptions,
    ) Error!void {
        const expected_message = try self.fmt("{s}, but found {s}", .{
            message,
            try self.describeToken(self.current_token),
        });
        try self.report(span, expected_message, opts);
    }

    pub fn label(_: *Parser, span: ast.Span, message: []const u8) ast.Label {
        return .{ .span = span, .message = message };
    }

    pub fn labels(self: *Parser, items: []const ast.Label) Error![]const ast.Label {
        return self.allocator().dupe(ast.Label, items) catch ast.outOfMemory();
    }

    pub fn fmt(self: *Parser, comptime format: []const u8, args: anytype) Error![]u8 {
        return self.allocator().print(format, args) catch ast.outOfMemory();
    }

    pub fn recover(self: *Parser, terminator: ?TokenTag) Error!void {
        while (self.current_token.tag != .eof) {
            if (self.batchMode() and !self.array_window) {
                self.current_token = self.arrayNext(self.token_array.?);
            } else if (self.batchMode()) {
                self.current_token = try self.recoverNextToken();
            } else {
                // a failed rescan leaves the lexer inside the current token, which is then stale
                if (self.current_token.span.end <= self.lexer.cursor) {
                    try self.commitToken(self.current_token);
                }
                self.current_token = try self.recoverNextToken();
            }
            if (self.current_token.tag == terminator) break;
            if (self.current_token.hasLineTerminatorBefore() and
                self.current_token.tag.isKeyword()) break;
        }
    }

    fn recoverNextToken(self: *Parser) Error!Token {
        while (true) {
            return self.lexer.nextToken() catch |e| {
                if (e == error.OutOfMemory) ast.outOfMemory();
                if (self.lexer.cursor < self.source.len) {
                    self.lexer.cursor += 1;
                } else {
                    return Token.eof(@intCast(self.source.len));
                }
                continue;
            };
        }
    }

    fn ensureCapacity(self: *Parser) std.mem.Allocator.Error!void {
        std.debug.assert(self.tree.nodes.capacity == 0);
        const alloc = self.allocator();
        const source_len = self.source.len;
        if (self.batchMode()) {
            // the token count is known exactly; nodes/tokens and extras/tokens
            // measure 0.76-1.0 and 0.23-0.26 across real files
            const tokens_len = self.token_array.?.len;
            try self.tree.nodes.ensureTotalCapacity(alloc, tokens_len + tokens_len / 8);
            try self.tree.extras.ensureTotalCapacity(alloc, tokens_len / 3 + 64);
        } else {
            const is_small = source_len < 512_000;
            const estimated_nodes = if (is_small) @max(256, source_len / 2) else source_len / 4;
            const estimated_extra = if (is_small) source_len / 6 else source_len / 12;

            try self.tree.nodes.ensureTotalCapacity(alloc, estimated_nodes);
            try self.tree.extras.ensureTotalCapacity(alloc, estimated_extra);
        }
        try self.scratch_cover.items.ensureTotalCapacity(alloc, 256);
        try self.scratch_statements.items.ensureTotalCapacity(alloc, 256);
        try self.scratch_a.items.ensureTotalCapacity(alloc, 256);
        try self.scratch_b.items.ensureTotalCapacity(alloc, 256);
        try self.scratch_decorators.items.ensureTotalCapacity(alloc, 128);
        if (self.collect_tokens) {
            try self.tokens.ensureTotalCapacity(alloc, @max(64, source_len / 3));
        }
    }
};

pub const Checkpoint = struct {
    lexer_cursor: u32,
    lexer_state: lexer.LexerState,
    lexer_mode: lexer.LexerMode,
    lexer_comments_len: usize,

    current_token: Token,
    prev_token_end: u32,
    read_index: u32,
    array_window: bool,

    nodes_len: usize,
    extras_len: usize,
    diagnostics_len: usize,
    tokens_len: usize,

    context: Context,
    ts_context: TsContext,
    state: ParserState,
};

const ScratchBuffer = struct {
    items: std.ArrayList(ast.NodeIndex) = .empty,

    pub inline fn begin(self: *ScratchBuffer) usize {
        return self.items.items.len;
    }

    pub inline fn append(
        self: *ScratchBuffer,
        alloc: std.mem.Allocator,
        index: ast.NodeIndex,
    ) Error!void {
        if (self.items.items.len < self.items.capacity) {
            self.items.appendAssumeCapacity(index);
        } else {
            self.items.append(alloc, index) catch ast.outOfMemory();
        }
    }

    pub inline fn reset(self: *ScratchBuffer, checkpoint: usize) void {
        self.items.shrinkRetainingCapacity(checkpoint);
    }
};

/// Parses JavaScript or TypeScript source into a `Tree`. Call `deinit()` to free it.
pub fn parse(
    child_allocator: std.mem.Allocator,
    source: []const u8,
    options: Options,
) Error!ast.Tree {
    if (batch_lexing and options.lex_strategy == .batch) {
        return parseBatch(child_allocator, source, options);
    }
    var parser: Parser = .{
        .tree = ast.Tree.init(child_allocator, source),
        .source = source,
        .preserve_parens = options.preserve_parens,
        .comment_mode = options.comments,
        .collect_tokens = options.tokens,
        .lexer = undefined,
        .current_token = Token.eof(0),
    };
    parser.tree.source_type = options.source_type;
    parser.tree.lang = options.lang;
    return parser.parse();
}

/// Parses from a pre-scanned token array instead of driving the lexer. The array
/// must be the stream a collecting parse consumed, ending with `eof`. `tokens`
/// and `carried_comments` must outlive the returned tree.
pub fn parseFromTokens(
    child_allocator: std.mem.Allocator,
    source: []const u8,
    tokens: []const Token,
    carried_comments: []const ast.Comment,
    options: Options,
) Error!ast.Tree {
    if (!batch_lexing) return parse(child_allocator, source, options);
    std.debug.assert(tokens.len > 0);
    std.debug.assert(tokens[tokens.len - 1].tag == .eof);
    var parser: Parser = .{
        .tree = ast.Tree.init(child_allocator, source),
        .source = source,
        .preserve_parens = options.preserve_parens,
        .comment_mode = options.comments,
        .collect_tokens = false,
        .lexer = undefined,
        .current_token = Token.eof(0),
        .token_array = tokens,
        .carried_comments = carried_comments,
    };
    parser.tree.source_type = options.source_type;
    parser.tree.lang = options.lang;
    return parser.parse();
}

/// `parse` with `lex_strategy == .batch`: a collecting pass produces the token
/// array, then the array drives a second parse.
fn parseBatch(child_allocator: std.mem.Allocator, source: []const u8, options: Options) Error!ast.Tree {
    var collect_options = options;
    collect_options.tokens = true;
    collect_options.lex_strategy = .on_demand;
    var first = try parse(child_allocator, source, collect_options);
    // lexical errors left no mark on the collected stream, so the second parse
    // could not replay them; the first tree already says everything
    if (first.diagnostics.items.len > 0) return first;
    defer first.deinit();

    var parser: Parser = .{
        .tree = ast.Tree.init(child_allocator, source),
        .source = source,
        .preserve_parens = options.preserve_parens,
        .comment_mode = options.comments,
        .collect_tokens = false,
        .lexer = undefined,
        .current_token = Token.eof(0),
    };
    parser.tree.source_type = options.source_type;
    parser.tree.lang = options.lang;
    parser.token_array = parser.allocator().dupe(Token, first.tokens) catch ast.outOfMemory();
    parser.carried_comments = parser.allocator().dupe(ast.Comment, first.comments) catch ast.outOfMemory();
    return parser.parse();
}
