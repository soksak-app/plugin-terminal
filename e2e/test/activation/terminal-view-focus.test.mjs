// Unit checks of the terminal input stage of the focus checks: the visible input before the cursor, the screen facts of the sidecar
// in the event log, and the terminal IME stage whose screen, cursor and composition statuses agree with the presented frame.
import assert from "node:assert/strict";
import test from "node:test";

function cellIndexAtColumn(cells, target) {
  let column = 0;
  for (let index = 0; index < cells.length; index++) {
    const width = cells[index].width;
    assert.ok(Number.isInteger(width) && width >= 0,
      `terminal screen cell has invalid width: ${JSON.stringify(cells[index])}`);
    if (width === 0) continue;
    if (column === target) return index;
    assert.ok(target >= column + width || target <= column,
      `terminal cursor splits a wide screen cell: ${JSON.stringify({ target, column, cell: cells[index] })}`);
    column += width;
  }
  assert.equal(column, target, `terminal cursor column is outside the row: ${JSON.stringify({ target, column })}`);
  return cells.length;
}

function cellTextBetweenColumns(cells, start, end) {
  assert.ok(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start,
    `invalid terminal screen column range ${start}..${end}`);
  const first = cellIndexAtColumn(cells, start);
  const last = cellIndexAtColumn(cells, end);
  return cells.slice(first, last).map((cell) => cell.ch === undefined ? "" : cell.ch).join("");
}

function visibleInputBeforeCursor(screen, cursor, prompt, composeText = "") {
  assert.ok(Number.isInteger(cursor.row) && Number.isInteger(cursor.col),
    `terminal cursor has no cell position: ${JSON.stringify(cursor)}`);
  assert.ok(cursor.row >= prompt.row && cursor.row < screen.lines.length,
    `terminal cursor row is outside the screen: ${JSON.stringify({ cursor, rows: screen.lines.length })}`);
  const rows = [];
  for (let row = prompt.row; row <= cursor.row; row++) {
    const cells = screen.lines[row];
    const start = row === prompt.row ? prompt.col : 0;
    const end = row === cursor.row ? cursor.col : cells.reduce((columns, cell) => columns + cell.width, 0);
    rows.push(cellTextBetweenColumns(cells, start, end));
  }
  const committed = rows.join("");
  assert.ok(committed.startsWith(prompt.text),
    `terminal cursor prefix lost its initial shell prompt: ${JSON.stringify({ prompt, cursor, committed })}`);
  return `${committed.slice(prompt.text.length)}${composeText}`;
}

test("visible input preserves the prompt, handles wide cells, and ignores later blanks", () => {
  const screen = { lines: [
    [{ ch: "$", width: 1 }, { ch: " ", width: 1 }, { ch: undefined, width: 1 }],
    [{ ch: "界", width: 2 }, { ch: undefined, width: 0 }, { ch: undefined, width: 1 }],
    [{ ch: undefined, width: 10 }],
  ] };
  const prompt = { row: 0, col: 0, text: cellTextBetweenColumns(screen.lines[0], 0, 2) };
  assert.equal(visibleInputBeforeCursor(screen, { row: 0, col: 2 }, prompt, "ㅏ"), "ㅏ");
  assert.equal(visibleInputBeforeCursor(screen, { row: 1, col: 2 }, prompt, "ㅏ"), "界ㅏ");
  const mixed = { lines: [[{ ch: "$", width: 1 }, { ch: " ", width: 1 },
    { ch: "ㅏ", width: 1 }, { ch: "ㅏ", width: 1 }]] };
  const mixedPrompt = { row: 0, col: 0, text: "$ " };
  assert.equal(visibleInputBeforeCursor(mixed, { row: 0, col: 4 }, mixedPrompt, "ㅏ"), "ㅏㅏㅏ");
  assert.equal(visibleInputBeforeCursor(mixed, { row: 0, col: 4 }, mixedPrompt, ""), "ㅏㅏ");
});

test("sidecar screen facts preserve the numeric row count and frame cursor", () => {
  const facts = inputEventFacts([{
    event: "host.trace.sidecar.receive",
    ts_us: 1000,
    mono_ns: 125000,
    fields: {
      surface: "tab-ime",
      body: {
        event: "screen",
        sequence: 7,
        rows: 1,
        cols: 3,
        cells: [{ grapheme: "$", width: 1 }, { grapheme: " ", width: 1 }, { grapheme: "ㅏ", width: 1 }],
        frame: { generation: 3, raster: 3, sequence: 12 },
        cursor: { row: 0, col: 8, preedit: { text: "ㅏ" } },
      },
    },
  }], "tab-ime");
  assert.deepEqual(facts, [{
    at: 1,
    mono_ns: 125000,
    layer: "sidecar.screen",
    sequence: 7,
    rowCount: 1,
    frame: { generation: 3, raster: 3, sequence: 12 },
    cursor: { row: 0, col: 8, preedit: { text: "ㅏ" } },
    lines: ["$ ㅏ"],
  }]);
});

function frameMatches(left, right) {
  return left?.generation === right?.generation && left?.raster === right?.raster &&
    left?.sequence === right?.sequence;
}

function assertTerminalStageCoherent(stage, screenEvents, name) {
  assert.equal(stage.compose.text, stage.cursor.preedit?.text ?? "",
    `${name}: page composition and sidecar cursor preedit must agree`);
  const matchingFrames = screenEvents.filter((event) => frameMatches(event.frame, stage.frame));
  assert.ok(matchingFrames.length > 0,
    `${name}: no sidecar screen event names presented frame ${JSON.stringify(stage.frame)}`);
  assert.ok(matchingFrames.some((event) => event.rowCount === stage.rows.length &&
    event.cursor?.row === stage.cursor.row && event.cursor?.col === stage.cursor.col &&
    (event.cursor?.preedit?.text ?? "") === (stage.cursor.preedit?.text ?? "") &&
    JSON.stringify(event.lines) === JSON.stringify(stage.screen)),
  `${name}: sidecar screen rows and cursor do not match the presented frame`);
}

async function waitForTerminalImeStage(session, surface, before, name) {
  const names = ["terminal.screen", "terminal.cursor", "terminal.compose"];
  const values = new Map();
  const revisions = new Map(names.map((status) => [status, 0]));
  let resolveCoherent;
  const coherent = new Promise((resolve) => { resolveCoherent = resolve; });
  const check = () => {
    const screen = values.get("terminal.screen");
    const compose = values.get("terminal.compose");
    const cursor = values.get("terminal.cursor");
    const changed = JSON.stringify(screen) !== JSON.stringify(before.screen) ||
      compose?.text !== before.compose.text || cursor?.row !== before.cursor.row ||
      cursor?.col !== before.cursor.col || cursor?.preedit?.text !== before.cursor.preedit?.text;
    if (changed && typeof compose?.text === "string" && compose.text === cursor?.preedit?.text) {
      resolveCoherent({ screen, compose, cursor });
    }
  };
  const off = session.client.on("status.changed", (params) => {
    if (params?.window !== session.window || params.surface !== surface || !names.includes(params.name)) return;
    values.set(params.name, params.value);
    revisions.set(params.name, revisions.get(params.name) + 1);
    check();
  });
  const watched = [];
  let result;
  let failure;
  try {
    for (const status of names) {
      await session.request("status.watch", { name: status, surface });
      watched.push(status);
    }
    for (const status of names) {
      const revision = revisions.get(status);
      const value = await session.get(status, surface);
      if (revisions.get(status) === revision) values.set(status, value);
      check();
    }
    // The wait has no time limit: the coherent statuses or the end of the connection end it.
    result = await Promise.race([coherent, session.client.ended.then(() => {
      throw new Error(`${name}: the connection ended before the terminal cursor and composition statuses converged`);
    })]);
  } catch (error) {
    failure = error;
  } finally {
    off();
    const cleanupErrors = [];
    for (const status of watched.reverse()) {
      try { await session.request("status.unwatch", { name: status, surface }); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      failure = failure ? new AggregateError([failure, ...cleanupErrors], `${name}: observation and status cleanup failed`)
        : new AggregateError(cleanupErrors, `${name}: status cleanup failed`);
    }
  }
  if (failure) throw failure;
  return result;
}

test("terminal IME stage waits for cursor notification after composition changes", async () => {
  const listeners = new Set();
  const before = { screen: ["$ "], compose: { text: "ㅏ" }, cursor: { row: 0, col: 1, preedit: { text: "ㅏ" } } };
  const session = {
    window: "main",
    client: { ended: new Promise(() => {}), on(name, listener) { assert.equal(name, "status.changed"); listeners.add(listener); return () => listeners.delete(listener); } },
    async request(method, { name }) {
      assert.ok(["status.watch", "status.unwatch"].includes(method));
      assert.ok(["terminal.screen", "terminal.compose", "terminal.cursor"].includes(name));
    },
    async get(name) {
      if (name === "terminal.screen") return before.screen;
      if (name === "terminal.compose") return { text: "ㅏㅏ" };
      queueMicrotask(() => {
        for (const listener of listeners) listener({ window: "main", surface: "tab-ime", name,
          value: { row: 0, col: 2, preedit: { text: "ㅏㅏ" } } });
      });
      return { row: 0, col: 1, preedit: { text: "ㅏ" } };
    },
  };

  const stage = await waitForTerminalImeStage(session, "tab-ime", before, "fixture");
  assert.equal(stage.compose.text, "ㅏㅏ");
  assert.equal(stage.cursor.preedit.text, "ㅏㅏ");
  assert.equal(listeners.size, 0);
});

test("terminal IME stage waits for cursor movement when native preedit stays unchanged", async () => {
  const listeners = new Set();
  const before = { screen: ["$ ㅏ"], compose: { text: "ㅏㅏ" }, cursor: { row: 0, col: 2, preedit: { text: "ㅏㅏ" } } };
  const session = {
    window: "main",
    client: { ended: new Promise(() => {}), on(name, listener) { assert.equal(name, "status.changed"); listeners.add(listener); return () => listeners.delete(listener); } },
    async request(method, { name }) {
      assert.ok(["status.watch", "status.unwatch"].includes(method));
      assert.ok(["terminal.screen", "terminal.compose", "terminal.cursor"].includes(name));
    },
    async get(name) {
      if (name === "terminal.screen") return before.screen;
      if (name === "terminal.compose") return before.compose;
      queueMicrotask(() => {
        for (const listener of listeners) listener({ window: "main", surface: "tab-ime", name,
          value: { row: 0, col: 3, preedit: { text: "ㅏㅏ" } } });
      });
      return before.cursor;
    },
  };

  const stage = await waitForTerminalImeStage(session, "tab-ime", before, "fixture");
  assert.equal(stage.compose.text, before.compose.text);
  assert.equal(stage.cursor.preedit.text, before.cursor.preedit.text);
  assert.equal(stage.cursor.col, 3);
  assert.equal(listeners.size, 0);
});

test("terminal IME stage rereads coherent composition on a screen notification", async () => {
  const listeners = new Set();
  const before = { screen: ["$ "], compose: { text: "ㅏ" }, cursor: { row: 0, col: 2, preedit: { text: "ㅏ" } } };
  const session = {
    window: "main",
    client: { ended: new Promise(() => {}), on(name, listener) { assert.equal(name, "status.changed"); listeners.add(listener); return () => listeners.delete(listener); } },
    async request(method, { name }) {
      assert.ok(["status.watch", "status.unwatch"].includes(method));
      assert.ok(["terminal.screen", "terminal.compose", "terminal.cursor"].includes(name));
    },
    async get(name) {
      if (name === "terminal.screen") {
        queueMicrotask(() => {
          for (const listener of listeners) listener({ window: "main", surface: "tab-ime", name,
            value: ["$ ㅏ"] });
        });
        return before.screen;
      }
      return before[name === "terminal.compose" ? "compose" : "cursor"];
    },
  };

  const stage = await waitForTerminalImeStage(session, "tab-ime", before, "fixture");
  assert.deepEqual(stage.screen, ["$ ㅏ"]);
  assert.equal(stage.compose.text, "ㅏ");
  assert.equal(stage.cursor.preedit.text, "ㅏ");
  assert.equal(listeners.size, 0);
});

test("terminal stage requires matching screen, cursor, and compose state", () => {
  const stage = {
    frame: { generation: 2, raster: 4, sequence: 12 },
    rows: [{}, {}],
    screen: ["$ ㅏ", ""],
    cursor: { row: 0, col: 2, preedit: { text: "ㅏ" } },
    compose: { text: "ㅏ" },
  };
  const event = { rowCount: 2, frame: { ...stage.frame }, lines: stage.screen,
    cursor: { row: 0, col: 2, preedit: { text: "ㅏ" } } };
  assert.doesNotThrow(() => assertTerminalStageCoherent(stage, [event], "fixture"));
  assert.throws(() => assertTerminalStageCoherent(stage, [{ ...event, frame: { ...event.frame, sequence: 11 } }], "fixture"),
    /no sidecar screen event names presented frame/);
  assert.throws(() => assertTerminalStageCoherent(stage, [{ ...event, lines: ["$", ""] }], "fixture"),
    /screen rows and cursor do not match/);
  assert.throws(() => assertTerminalStageCoherent({ ...stage, compose: { text: "" } }, [event], "fixture"),
    /page composition and sidecar cursor preedit must agree/);
});

function inputEventFacts(events, surface) {
  const facts = [];
  for (const event of events) {
    const fields = event.fields ?? {};
    const at = event.ts_us / 1000;
    const cid = event.cids?.[0];
    if (event.event === "native.record.info" && fields.where === "input inject") {
      try {
        const input = JSON.parse(fields.text);
        if (input.kind === "key") facts.push({ at, layer: "native.inject", key: input.key, down: input.down,
          result: input.result, responder: input.responder, keyWindow: input.keyWindow });
      } catch { /* the host event remains available in the stored log */ }
    } else if (event.event === "native.input.key_down") {
      facts.push({ at, layer: "native.keyDown", key: fields.characters, cid,
        active: fields.before?.active, keyWindow: fields.before?.keyWindow, focus: fields.before?.focus });
    } else if (event.event === "native.input.report") {
      try {
        const report = JSON.parse(fields.report);
        if (report.type === "insert" || report.type === "key" || report.type === "focus") {
          facts.push({ at, layer: "native.report", type: report.type, key: report.text ?? report.key,
            cid, dropped: fields.dropped });
        }
      } catch { /* the host event remains available in the stored log */ }
    } else if (event.event === "host.input.relay" && fields.surface === surface) {
      facts.push({ at, layer: "host.relay", type: fields.type, key: fields.text ?? fields.key, cid });
    } else if (event.event === "host.trace.region" && fields.surface === surface) {
      const body = fields.body ?? {};
      if (body.type === "insert" || body.type === "key" || body.type === "focus") {
        facts.push({ at, layer: "host.region", type: body.type, key: body.text ?? body.key,
          cid: body.cids?.[0] });
      }
    } else if ((event.event === "plugin.terminal.ime" || event.event === "plugin.terminal.region") && fields.surface === surface) {
      if (fields.type === "insert" || fields.type === "key" || fields.type === "focus") {
        facts.push({ at, layer: event.event.endsWith(".ime") ? "plugin.ime" : "plugin.region",
          type: fields.type, key: fields.text ?? fields.key, cid: fields.cids?.[0] });
      }
    } else if ((event.event === "host.trace.sidecar.send" || event.event === "plugin.terminal.send") && fields.surface === surface) {
      const body = fields.body ?? {};
      if (body.operation === "input" && (body.bytes !== undefined || body.keys !== undefined)) {
        const bytes = body.bytes === undefined ? undefined : Buffer.from(body.bytes, "base64").toString("latin1");
        facts.push({ at, layer: "plugin.sidecarSend", bytes, keys: body.keys });
      }
    } else if (event.event === "sidecar.vt.pty_write" || event.event === "sidecar.vt.pty_read") {
      facts.push({ at, layer: event.event.endsWith("pty_write") ? "pty.write" : "pty.read",
        text: Buffer.from(fields.hex ?? "", "hex").toString("latin1"), sequence: fields.sequence });
    } else if (event.event === "host.window.event") {
      facts.push({ at, layer: "host.window.event", fields });
    } else if (event.event === "host.trace.sidecar.receive" && fields.surface === surface &&
      fields.body?.event === "screen") {
      const body = fields.body;
      facts.push({ at, mono_ns: event.mono_ns, layer: "sidecar.screen", sequence: body.sequence,
        frame: body.frame, cursor: body.cursor, rowCount: body.rows,
        lines: Array.from({ length: body.rows }, (_, row) => body.cells.slice(row * body.cols, (row + 1) * body.cols)
          .map((cell) => cell.grapheme === "" ? " ".repeat(cell.width) : cell.grapheme).join("").trimEnd()) });
    }
  }
  return facts;
}
